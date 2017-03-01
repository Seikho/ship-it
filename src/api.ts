import * as log from './log'
import { APICaller, UpsertOptions } from './types'

export async function upsertAPIPermission(opts: UpsertOptions) {
    const { config, restApi, lambda, lambdaApi } = opts
    const caller = opts.caller as APICaller

    const statementId = `${restApi.name}-${lambda.FunctionName}`
    const baseConfig = {
        Action: 'lambda:InvokeFunction',
        FunctionName: lambda.FunctionName as string,
        Principal: 'apigateway.amazonaws.com',
    }

    const callerPath = caller.path.replace(/\{.*?\}/, '*')
    const arn = `arn:aws:execute-api:${config.region}:${config.accountId}:${restApi.id}/*/${caller.method}${callerPath}`

    log.info(`Delete '${config.stageName} ${caller.path}' Permission`)
    await lambdaApi.removePermission({
        StatementId: statementId,
        FunctionName: lambda.FunctionName as string,
    }).promise().catch(() => { /** Intentional NOOP */ })

    log.info(`Add '${config.stageName} ${caller.path}' Permission`)
    const result = await lambdaApi.addPermission({
        ...baseConfig,
        StatementId: statementId,
        SourceArn: arn
    }).promise().catch(() => { })
    log.debug(log.stringify(result || {}))
}

export async function upsertMethod(opts: UpsertOptions) {
    const { config, restApi, resourceId, gateway } = opts
    const caller = opts.caller as APICaller
    const restApiId = restApi.id as string

    try {
        const method = await gateway.getMethod({
            httpMethod: caller.method,
            resourceId,
            restApiId,
        }).promise()

        return method
    } catch (ex) {

        log.info(`Put Method '${caller.method} ${caller.path}'`)
        log.info(`${caller.method} https://${restApiId}.execute-api.${config.region}.amazonaws.com/${config.stageName}${caller.path}`)

        const method = await gateway.putMethod({
            resourceId,
            httpMethod: caller.method,
            restApiId,
            requestParameters: {},
            authorizationType: 'NONE'
        }).promise()

        log.debug(log.stringify(method))

        return method
    }
}

export async function upsertMethodResponse(opts: UpsertOptions) {
    const { gateway, restApi, resourceId } = opts
    const caller = opts.caller as APICaller
    const restApiId = restApi.id as string

    try {
        const method = await gateway.getMethodResponse({
            restApiId,
            httpMethod: caller.method,
            resourceId,
            statusCode: '200'
        }).promise()
        return method
    } catch (ex) {

        const responseModels = {}
        responseModels[caller.contentType] = 'Empty'

        log.info(`Put Method Response '${caller.method} ${caller.path}'`)

        const method = await gateway.putMethodResponse({
            httpMethod: caller.method,
            resourceId,
            restApiId,
            statusCode: '200',
            responseModels
        }).promise()

        log.debug(log.stringify(method))
        return method
    }
}

export async function upsertIntegration(opts: UpsertOptions) {
    const { gateway, restApi, resourceId, config, lambda } = opts
    const caller = opts.caller as APICaller
    const restApiId = restApi.id as string
    const requestTemplates = {
        'params': `$input.params()`,
        'body': `$input.body`,
        'path': `$input.params().path`,
        'querystring': `$input.params().querystring`,
        'headers': `$input.params().header`
    }

    const pathParam = /\{.*?\}/.exec(caller.path)
    if (pathParam) {
        const part = pathParam[0].slice(1, -1) as string
        requestTemplates[part] = `$input.params('${part}')`
    }

    try {
        const integration = await gateway.getIntegration({
            resourceId,
            restApiId,
            httpMethod: caller.method
        }).promise()

        return integration
    } catch (ex) {
        log.info(`Put Integration '${caller.method} ${caller.path}'`)

        const integration = await gateway.putIntegration({
            contentHandling: 'CONVERT_TO_TEXT',
            resourceId,
            restApiId,
            requestTemplates: {
                'application/json': JSON.stringify(requestTemplates)
            },
            type: 'AWS',
            httpMethod: caller.method,
            integrationHttpMethod: 'POST', // This must be set to 'POST' for Lambda pass-through
            uri: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${config.region}:${config.accountId}:function:${lambda.FunctionName}/invocations`
        }).promise()

        log.debug(log.stringify(integration))

        return integration
    }
}

export async function upsertIntegrationResponse(opts: UpsertOptions) {
    const { gateway, restApi, resourceId } = opts
    const caller = opts.caller as APICaller
    const restApiId = restApi.id as string

    try {
        const integration = await gateway.getIntegrationResponse({
            restApiId,
            httpMethod: caller.method,
            resourceId,
            statusCode: '200'
        }).promise()

        return integration
    } catch (ex) {
        log.info(`Put Integration Response '${caller.method} ${caller.path}'`)
        const integration = await gateway.putIntegrationResponse({
            httpMethod: caller.method,
            resourceId,
            restApiId,
            statusCode: '200',
            responseTemplates: {
                'application/json': ''
            }
        }).promise()
        log.debug(log.stringify(integration))
        return integration
    }
}