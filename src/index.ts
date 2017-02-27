import * as AWS from 'aws-sdk'
import * as Zip from 'jszip'
import { Lambda, APICaller } from './types'
import deployLambda from './lambda'
import print from './print'
import * as fs from 'fs'
import * as path from 'path'

export interface AWSConfig {
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
  private deployments: AWS.APIGateway.Deployment[]

  private gateway = new AWS.APIGateway({
    apiVersion: '2015-07-09'
  })

  private lambda = new AWS.Lambda({
    apiVersion: '2015-03-31'
  })

  // private events = new AWS.CloudWatchEvents({
  //   apiVersion: '2015-10-07'
  // })

  constructor(private config: AWSConfig) {
    AWS.config.update({
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    })
  }

  async register(lambda: Lambda) {
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
    if (this.semaphor) {
      throw new DeployError('Already deploying')
    }

    this.clean()

    try {
      this.semaphor = true

      await this.deployResources()
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

  private async deployResources() {
    const restApis = await this.gateway.getRestApis({
      limit: 0
    }).promise()

    if (restApis.items) {
      const restApi = restApis.items.find(item => item.name === process.env.AWS_API_NAME)
      if (restApi) {
        this.restApi = restApi
      }
    }

    if (!this.restApi) {
      // TODO: Error handling
      this.restApi = await print(this.gateway.createRestApi({
        name: process.env.AWS_API_NAME
      }).promise(), `Create RestAPI '${process.env.AWS_API_NAME}'`)
    }

    const deployments = await this.gateway.getDeployments({
      restApiId: this.restApi.id as string
    }).promise()
    this.deployments = deployments.items || []

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

  private async upsertResource(path: string) {
    console.log(`Upserting Resource: ${path}`)
    if (path === '/') {
      // This is assumed to exist
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
        restApiId: this.restApi.id as string
      }).promise(), `Create Resource '${path}'`)
      this.resourceMap[path] = newResource
    }
  }

  private async deployAPICaller(caller: APICaller, lambda: AWS.Lambda.FunctionConfiguration) {

    // Assumed to exist at this point
    // This is run after upsertResource
    const resource = this.resourceMap[caller.path]
    const resourceId = resource.id as string
    const restApiId = this.restApi.id as string
    const httpMethod = caller.method

    const opts = { resourceId, httpMethod }
    await this.upsertMethod(opts)
    await this.upsertIntegration(opts, lambda.FunctionName as string)
    await this.upsertMethodResponse(opts)
    await this.upsertIntegrationResponse(opts)
    await this.upsertPermission(caller, lambda)

    let deployment = this.deployments
      .find(dep => (dep.description || '').split('__')[0] === this.config.stageName)
    if (!deployment) {
      deployment = await this.gateway.createDeployment({
        restApiId,
        description: `${this.config.stageName}__lambda.Description`
      }).promise()
    }
  }

  private async upsertPermission(caller: APICaller, lambda: AWS.Lambda.FunctionConfiguration) {
    const statementId = `${this.config.stageName}-${this.restApi.name}-${lambda.FunctionName}`
    await print(this.lambda.addPermission({
      Action: 'lambda:InvokeFunction',
      StatementId: statementId,
      FunctionName: lambda.FunctionName as string,
      Principal: 'apigateway.amazonaws.com',
      SourceArn: `arn:aws:execute-api:${this.config.region}:${this.config.accountId}/${this.config.stageName}/${caller.method}/${this.restApi.name}`
    }).promise().catch(() => { /** Intentional NOOP */ }), 'Add Permission')
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
        authorizationType: 'NONE'
      }).promise(), 'Put Method')
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
        httpMethod,
        integrationHttpMethod: httpMethod,
        resourceId,
        restApiId,
        type: 'AWS',
        uri: `arn:aws:apigateway:${this.config.region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${this.config.region}:${this.config.accountId}:function:${functionName}/invocations`
      }).promise(), 'Put Integration')
      return integration
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

