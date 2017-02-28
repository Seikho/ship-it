
// arn:aws:lambda:ap-southeast-2:291971919224:function:Geddit-Quote-13

import * as AWS from 'aws-sdk'
import * as Zip from 'jszip'
import { Lambda, APICaller, Caller, EventCaller } from './types'
import deployLambda from './lambda'
import * as log from './log'
import * as fs from 'fs'
import * as path from 'path'

export {
  Lambda,
  APICaller,
  Caller,
  EventCaller
}

export interface DeployerConfiguration {
  apiName: string
  stageName: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  accountId: string
  role: string
}

type Upsert = { resourceId: string, httpMethod: string }

type ResourceMap = { [path: string]: AWS.APIGateway.Resource }

export default class Deployer {

  // Lambda concerns
  private handlers: Array<Lambda & { archive: Buffer }> = []
  private semaphor = false

  // Resource concerns
  private restApi: AWS.APIGateway.RestApi
  private resourceMap: ResourceMap = {}

  private gateway = new AWS.APIGateway({
    apiVersion: '2015-07-09'
  })

  private lambda = new AWS.Lambda({
    apiVersion: '2015-03-31'
  })

  // TODO: Support Event Callers
  // private events = new AWS.CloudWatchEvents({
  //   apiVersion: '2015-10-07'
  // })

  constructor(public config: DeployerConfiguration) {

  }

  async register(lambda: Lambda) {
    /**
     * Deploying is not cheap and not expected to exist in hot paths
     * Expensive blocking calls are allowed
     */
    const zip = new Zip()
    const files = lambda.files

    for (const file of files) {
      const buffer = fs.readFileSync(file)
      zip.file(path.basename(file), buffer)
    }

    const buffer: Buffer = await zip.generateAsync({ type: 'nodebuffer' })

    this.handlers.push({
      ...lambda,
      archive: buffer
    })
  }

  async deploy() {
    /**
     * Deploys cannot happen concurrently by instance of the Deployer
     */
    if (this.semaphor) {
      throw new DeployError('Already deploying')
    }

    // This will throw if the configuration is not valid
    // This also sets the aws-sdk configuration
    validateConfig(this.config)

    this.clean()

    try {
      this.semaphor = true

      /**
       * Create the RestAPI (API)
       * Ensure each Resource (route path) exists in the API
       * Then deploy each registered API Caller
       */
      await this.upsertRestAPI()
      for (const handler of this.handlers) {
        const lambdaConfig = await deployLambda(this.lambda, handler, this.config.role, handler.archive)
        const caller = handler.caller as APICaller
        await this.upsertResource(caller.path)
        await this.deployAPICaller(caller, lambdaConfig)
      }

    } finally {
      this.semaphor = false
    }
  }

  private async upsertRestAPI() {
    /**
     * RestAPIs cannot be fetched by name, so we must get every API and locate it in a list
     */
    const restApis = await this.gateway.getRestApis({
      limit: 0
    }).promise()

    if (restApis.items) {
      const restApi = restApis.items.find(item => item.name === this.config.apiName)
      if (restApi) {
        this.restApi = restApi
      }
    }

    if (!this.restApi) {
      log.info(`Create RestAPI '${this.config.apiName}'`)
      this.restApi = await this.gateway.createRestApi({
        name: this.config.apiName,
      }).promise()
      log.debug(log.stringify(this.restApi))
    }

    /**
     * Resources cannot be upserted deterministically one-by-one
     * Must fetch the entire resource list and work backwards
     */
    const resources = await this.gateway.getResources({
      restApiId: this.restApi.id as string
    }).promise()

    const resourceItems = resources.items as AWS.APIGateway.Resource[]
    this.resourceMap = resourceItems.reduce((prev, curr) => {
      if (!curr.path) {
        return prev
      }
      prev[curr.path] = curr
      return prev
    }, {} as ResourceMap)
  }

  /**
   * Rescursively work up each path tree and ensure each resource exists on the API
   */
  private async upsertResource(path: string) {
    if (path === '/') {
      // Root is always assumed to exist
      return
    }

    const parentPath = getParent(path)
    let parentResource = this.resourceMap[parentPath]
    if (!parentResource) {
      await this.upsertResource(parentPath)
    }

    parentResource = this.resourceMap[parentPath]

    const resource = this.resourceMap[path]
    if (resource) {
      // All parent Resources are assumed to exist
      return
    }

    if (!resource) {
      const pathPart = split(path).slice(-1)[0]
      log.info(`Create Resource '${path}'`)
      const newResource = await this.gateway.createResource({
        pathPart,
        parentId: parentResource.id as string,
        restApiId: this.restApi.id as string,
      }).promise()
      log.debug(log.stringify(newResource))
      this.resourceMap[path] = newResource
    }
  }

  private async deployAPICaller(caller: APICaller, lambda: AWS.Lambda.FunctionConfiguration) {

    // Assumed to exist at this point
    // This is run after upsertResource
    const resource = this.resourceMap[caller.path]
    const resourceId = resource.id as string
    const httpMethod = caller.method

    const opts = { resourceId, httpMethod }

    /**
     * Order is significant
     * Create the method on a resource then integrate the method with the Lambda
     * Once created, allow the API Gateway method to call the Lambda
     * Then deploy the API
     *
     * Upserting is done by attempting to locate the entity and creating it if it is not found
     * Permissions are slightly different in that they are removed and created every time
     */
    await this.upsertMethod(opts, caller)
    await this.upsertMethodResponse(opts, caller)
    await this.upsertIntegration({ ...opts, functionName: lambda.FunctionName as string }, caller)
    await this.upsertIntegrationResponse(opts, caller)
    await this.upsertPermission(caller, lambda)
    await this.upsertDeployment(lambda)
  }

  private async upsertDeployment(lambda: AWS.Lambda.FunctionConfiguration) {
    const description = `${this.config.stageName}__${lambda.FunctionName}`
    const deployments = await this.gateway.getDeployments({
      limit: 0,
      restApiId: this.restApi.id as string
    }).promise()

    for (const deployment of deployments.items || []) {
      if (deployment.description === description) {
        return
      }
    }

    log.info(`Create '${this.config.stageName}' deployment`)
    const result = await this.gateway.createDeployment({
      restApiId: this.restApi.id as string,
      description,
      stageDescription: this.config.stageName,
      stageName: this.config.stageName,
    }).promise()
    log.debug(log.stringify(result))
  }

  private async upsertPermission(caller: APICaller, lambda: AWS.Lambda.FunctionConfiguration) {
    const statementId = `${this.config.stageName}-${this.restApi.name}-${lambda.FunctionName}`
    const baseConfig = {
      Action: 'lambda:InvokeFunction',
      FunctionName: lambda.FunctionName as string,
      Principal: 'apigateway.amazonaws.com',
    }

    const testArn = `arn:aws:execute-api:${this.config.region}:${this.config.accountId}:${this.restApi.id}/*/${caller.method}${caller.path}`

    log.info(`Delete 'test-${this.config.stageName}' Permission`)
    await this.lambda.removePermission({
      StatementId: statementId,
      FunctionName: lambda.FunctionName as string,
    }).promise().catch(() => { })

    log.info(`Add 'test-${this.config.stageName}' Permission`)
    const result = await this.lambda.addPermission({
      ...baseConfig,
      StatementId: statementId,
      SourceArn: testArn
    }).promise().catch(() => { })
    log.debug(log.stringify(result || {}))
  }

  private async upsertMethod({ resourceId, httpMethod }: Upsert, caller: APICaller) {
    const restApiId = this.restApi.id as string

    try {
      const method = await this.gateway.getMethod({
        httpMethod,
        resourceId,
        restApiId
      }).promise()
      return method
    } catch (ex) {
      log.info(`Put Method '${httpMethod} ${caller.path}'`)
      const method = await this.gateway.putMethod({
        resourceId,
        httpMethod,
        restApiId,
        requestParameters: {},
        authorizationType: 'NONE'
      }).promise()
      log.debug(log.stringify(method))
      return method
    }
  }

  private async upsertMethodResponse({ resourceId, httpMethod }: Upsert, caller: APICaller) {
    const restApiId = this.restApi.id as string

    try {
      const method = await this.gateway.getMethodResponse({
        restApiId,
        httpMethod,
        resourceId,
        statusCode: '200'
      }).promise()
      return method
    } catch (ex) {

      const responseModels = {}
      responseModels[caller.contentType] = 'Empty'

      log.debug(`Put Method Response '${httpMethod} ${caller.path}'`)
      const method = await this.gateway.putMethodResponse({
        httpMethod,
        resourceId,
        restApiId,
        statusCode: '200',
        responseModels
      }).promise()
      log.debug(log.stringify(method))
      return method
    }
  }

  private async upsertIntegration({ resourceId, httpMethod, functionName }: Upsert & { functionName: string }, caller: APICaller) {
    const restApiId = this.restApi.id as string

    try {
      const integration = await this.gateway.getIntegration({
        resourceId,
        restApiId,
        httpMethod
      }).promise()
      return integration
    } catch (ex) {
      log.info(`Put Integration '${httpMethod} ${caller.path}'`)
      const integration = await this.gateway.putIntegration({
        contentHandling: 'CONVERT_TO_TEXT',
        resourceId,
        restApiId,
        type: 'AWS',
        httpMethod,
        integrationHttpMethod: 'POST', // This must be set to 'POST' for Lambda pass-through
        uri: `arn:aws:apigateway:${this.config.region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${this.config.region}:${this.config.accountId}:function:${functionName}/invocations`
      }).promise()
      log.debug(log.stringify(integration))
      return integration
    }
  }

  private async upsertIntegrationResponse({ resourceId, httpMethod }: Upsert, caller: APICaller) {
    const restApiId = this.restApi.id as string

    try {
      const integration = await this.gateway.getIntegrationResponse({
        restApiId,
        httpMethod,
        resourceId,
        statusCode: '200'
      }).promise()
      return integration
    } catch (ex) {
      log.info(`Put Integration Response '${httpMethod} ${caller.path}'`)
      const integration = await this.gateway.putIntegrationResponse({
        httpMethod,
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

  private clean() {
    this.resourceMap = {}
  }
}

class DeployError extends Error {
  constructor(message: string) {
    super(`Unable to deploy: ${message}`)
  }
}

function getParent(path: string) {
  if (path === '/') {
    return path
  }

  const parts = split(path)
  const parent = '/' + parts
    .slice(0, -1)
    .join('/')

  return parent
}

function split(path: string) {
  return path
    .split('/')
    .filter(part => !!part)
}

function validateConfig(config: DeployerConfiguration) {
  let error = false

  const props: Array<keyof DeployerConfiguration> = [
    'accountId',
    'region',
    'accessKeyId',
    'secretAccessKey',
    'apiName',
    'role',
    'stageName'
  ]

  for (const prop of props) {
    if (!config[prop]) {
      log.error(`Invalid configuration: No '${prop}' set`)
      error = true
    }
  }

  if (error) {
    throw new DeployError('Invalid configuration')
  }

  AWS.config.update({
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey
  })
}