import * as log from './log'
import { APICaller, UpsertOptions } from './types'

export async function removeAllAPIPermissions(opts: { lambda: AWS.Lambda.FunctionConfiguration, lambdaApi: AWS.Lambda }) {
    const { lambda, lambdaApi } = opts
    try {
        const policy = await lambdaApi.getPolicy({
            FunctionName: lambda.FunctionName as string
        }).promise()

        const parsed = JSON.parse(policy.Policy || '{}')
        const statements: any[] = parsed.Statement || []
        for (const statement of statements) {
            const StatementId = statement.Sid

            log.info(`Delete '${StatementId}' Permission`)
            await lambdaApi.removePermission({
                StatementId,
                FunctionName: lambda.FunctionName as string,
            }).promise().catch(err => {
                log.warn(`Failed to delete permission '${StatementId}': ${err.message || err}`)
                log.warn(log.stringify(err))
            })
        }
    } catch (ex) {
        // Intentional NOOP
    }
}

export async function addAPIPermission(opts: UpsertOptions) {
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

    log.info(`Add '${config.stageName} ${caller.path}' Permission`)
    const result = await lambdaApi.addPermission({
        ...baseConfig,
        StatementId: statementId,
        SourceArn: arn
    }).promise().catch(err => {
        log.warn(`Failed to add permission: ${err.message || err}`)
        log.warn(log.stringify(err))
    })
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

    const requestTemplates = `
    {
      "body" : $input.json('$'),
      "headers": {
        #foreach($header in $input.params().header.keySet())
        "$header": "$util.escapeJavaScript($input.params().header.get($header))" #if($foreach.hasNext),#end

        #end
      },
      "method": "$context.httpMethod",
      "params": {
        #foreach($param in $input.params().path.keySet())
        "$param": "$util.escapeJavaScript($input.params().path.get($param))" #if($foreach.hasNext),#end

        #end
      },
      "query": {
        #foreach($queryParam in $input.params().querystring.keySet())
        "$queryParam": "$util.escapeJavaScript($input.params().querystring.get($queryParam))" #if($foreach.hasNext),#end

        #end
      },
       "path": {
        #foreach($param in $input.params().path.keySet())
        "$param": "$util.escapeJavaScript($input.params().path.get($param))" #if($foreach.hasNext),#end
        #end
      }
    }
    `

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
                'application/json': requestTemplates
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