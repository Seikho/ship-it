
// arn:aws:lambda:ap-southeast-2:291971919224:function:Geddit-Quote-13

import * as AWS from 'aws-sdk'
import * as Zip from 'jszip'
import { Lambda, APICaller, Caller, EventCaller } from './types'
import deployLambda from './lambda'
import print from './print'
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

  constructor(private config: DeployerConfiguration) {
    AWS.config.update({
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    })
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
      this.restApi = await print(this.gateway.createRestApi({
        name: this.config.apiName,

      }).promise(), `Create RestAPI '${this.config.apiName}'`)
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
    console.log(`Upserting Resource: ${path}`)
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
      const newResource = await print(this.gateway.createResource({
        pathPart,
        parentId: parentResource.id as string,
        restApiId: this.restApi.id as string,
      }).promise(), `Create Resource '${path}'`)
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
    console.log('Caller Options: ')
    console.log(JSON.stringify(opts, null, 2))

    /**
     * Order is significant
     * Create the method on a resource then integrate the method with the Lambda
     * Once created, allow the API Gateway method to call the Lambda
     * Then deploy the API
     *
     * Upserting is done by attempting to locate the entity and creating it if it is not found
     * Permissions are slightly different in that they are removed and created every time
     */
    await this.upsertMethod(opts)
    await this.upsertMethodResponse(opts)
    await this.upsertIntegration(opts, lambda.FunctionName as string)
    await this.upsertIntegrationResponse(opts)
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

    await print(this.gateway.createDeployment({
      restApiId: this.restApi.id as string,
      description,
      stageDescription: this.config.stageName,
      stageName: this.config.stageName,
    }).promise(), `Create '${this.config.stageName}' deployment`)
  }

  private async upsertPermission(caller: APICaller, lambda: AWS.Lambda.FunctionConfiguration) {
    const statementId = `${this.config.stageName}-${this.restApi.name}-${lambda.FunctionName}`
    const baseConfig = {
      Action: 'lambda:InvokeFunction',
      FunctionName: lambda.FunctionName as string,
      Principal: 'apigateway.amazonaws.com',
    }

    const testArn = `arn:aws:execute-api:${this.config.region}:${this.config.accountId}:${this.restApi.id}/*/${caller.method}${caller.path}`
    await print(this.lambda.removePermission({
      StatementId: statementId,
      FunctionName: lambda.FunctionName as string,
    }).promise().catch(() => { }), `Delete 'test-${this.config.stageName}' Permission`)

    await print(this.lambda.addPermission({
      ...baseConfig,
      StatementId: statementId,
      SourceArn: testArn
    }).promise().catch(() => { }), `Add 'test-${this.config.stageName}' Permission`)
  }

  private async upsertMethod({ resourceId, httpMethod }: Upsert) {
    const restApiId = this.restApi.id as string

    try {
      const method = await this.gateway.getMethod({
        httpMethod,
        resourceId,
        restApiId
      }).promise()
      return method
    } catch (ex) {
      const method = await print(this.gateway.putMethod({
        resourceId,
        httpMethod,
        restApiId,
        requestParameters: {},
        authorizationType: 'NONE'
      }).promise(), 'Put Method')
      return method
    }
  }

  private async upsertMethodResponse({ resourceId, httpMethod }: Upsert) {
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
      const method = await print(this.gateway.putMethodResponse({
        httpMethod,
        resourceId,
        restApiId,
        statusCode: '200',
        responseModels: {
          'application/json': 'Empty'
        }
      }).promise(), 'Put Method Response')
      return method
    }
  }

  private async upsertIntegration({ resourceId, httpMethod }: Upsert, functionName: string) {
    const restApiId = this.restApi.id as string

    try {
      const integration = await this.gateway.getIntegration({
        resourceId,
        restApiId,
        httpMethod
      }).promise()
      return integration
    } catch (ex) {
      const integration = await print(this.gateway.putIntegration({
        contentHandling: 'CONVERT_TO_TEXT',
        resourceId,
        restApiId,
        type: 'AWS',
        httpMethod,
        integrationHttpMethod: 'POST', // This must be set to 'POST' for Lambda pass-through
        uri: `arn:aws:apigateway:${this.config.region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${this.config.region}:${this.config.accountId}:function:${functionName}/invocations`
      }).promise(), 'Put Integration')
      return integration
    }
  }

  private async upsertIntegrationResponse({ resourceId, httpMethod }: Upsert) {
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
      const integration = await print(this.gateway.putIntegrationResponse({
        httpMethod,
        resourceId,
        restApiId,
        statusCode: '200',
        responseTemplates: {
          'application/json': ''
        }
      }).promise(), 'Put Integration Response')
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

