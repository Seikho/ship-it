import { EventCaller, UpsertOptions } from './types'
import * as log from './log'

export function getEventStatementName(opts: UpsertOptions) {
    const { lambda } = opts
    const caller = opts.caller as EventCaller

    const statementId = `${lambda.FunctionName}-${caller.name}`
    return statementId
}

export async function upsertEventPermission(opts: UpsertOptions) {
    const { config, lambda, lambdaApi } = opts
    const caller = opts.caller as EventCaller

    const statementId = getEventStatementName(opts)
    const baseConfig = {
        Action: 'lambda:InvokeFunction',
        FunctionName: lambda.FunctionName as string,
        Principal: 'events.amazonaws.com',
    }

    const arn = `arn:aws:events:${config.region}:${config.accountId}:rule/${statementId}`
    log.info(`Delete '${config.stageName}/${caller.name}' Permission`)
    await lambdaApi.removePermission({
        StatementId: statementId,
        FunctionName: lambda.FunctionName as string,
    }).promise().catch(() => { /** Intentional NOOP */ })

    log.info(`Add '${config.stageName}/${caller.name}' Permission`)
    const result = await lambdaApi.addPermission({
        ...baseConfig,
        StatementId: statementId,
        SourceArn: arn
    }).promise().catch(() => { })
    log.debug(log.stringify(result || {}))
}

export async function upsertEventRule(opts: UpsertOptions) {
    const { events, config } = opts
    const caller = opts.caller as EventCaller

    const statementId = getEventStatementName(opts)
    log.info(`Delete Event Rule '${config.stageName}/${caller.name}'`)

    await events.deleteRule({
        Name: statementId
    }).promise().catch(() => { /** Intentional NOOP */ })

    log.info(`Put Event Rule '${config.stageName}/${caller.name}'`)

    const rule = await events.putRule({
        ScheduleExpression: caller.schedule,
        Name: statementId,
        Description: caller.description
    }).promise()

    log.debug(log.stringify(rule))
}

export async function upsertTarget(opts: UpsertOptions) {
    const { events, config, lambda } = opts
    const caller = opts.caller as EventCaller

    const statementId = getEventStatementName(opts)

    const targets = await events.listTargetsByRule({
        Rule: statementId
    }).promise()

    if (targets.Targets && targets.Targets.length > 0) {
        log.info(`Delete Rule Targets '${config.stageName}/${caller.name}'`)
        const result = await events.removeTargets({
            Rule: statementId,
            Ids: targets.Targets.map(t => t.Id)
        }).promise()
        log.debug(log.stringify(result))
    }

    log.info(`Create Rule Target '${config.stageName}/${caller.name}'`)
    events.putTargets({
        Rule: statementId,
        Targets: [
            {
                Id: caller.name,
                Arn: `arn:aws:lambda:${config.region}:${config.accountId}:function:${lambda.FunctionName}`,
            }
        ]
    })
}