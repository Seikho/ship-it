import { Lambda, APICaller, Caller, EventCaller, DeployerConfiguration, UpsertOptions } from './types'
import { split, validateConfig, getParent } from './util'
import deployLambda from './lambda'
import * as AWS from 'aws-sdk'
import * as Zip from 'jszip'
import * as log from './log'
import * as fs from 'fs'
import * as path from 'path'
import * as api from './api'
import * as event from './event'

export {
  Lambda,
  APICaller,
  Caller,
  EventCaller
}

type ResourceMap = { [path: string]: AWS.APIGateway.Resource }

export default class Deployer {

  private handlers: Array<Lambda & { archive: Buffer }> = []
  private semaphor = false

  // APIGateway concerns
  private restApi: AWS.APIGateway.RestApi
  private resourceMap: ResourceMap = {}

  private gateway = new AWS.APIGateway({
    apiVersion: '2015-07-09'
  })

  // Lambda concerns
  private lambda = new AWS.Lambda({
    apiVersion: '2015-03-31'
  })

  // CloudWatchEvent concerns
  private events = new AWS.CloudWatchEvents({
    apiVersion: '2015-10-07'
  })

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
      throw new Error('Already deploying')
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
        const caller = handler.caller
        if (caller.kind === 'api') {
          await this.upsertResource(caller.path)
          await this.deployAPICaller(caller, lambdaConfig)
        } else {
          await this.deployEventCaller(caller, lambdaConfig)
        }
      }

    } finally {
      this.semaphor = false
    }
  }

  /**
  * Rescursively work up each path tree and ensure each resource exists on the API
  */
  async upsertResource(path: string) {
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

  private async deployAPICaller(caller: APICaller, lambda: AWS.Lambda.FunctionConfiguration) {

    // Assumed to exist at this point
    // This is run after upsertResource
    const resource = this.resourceMap[caller.path]
    const resourceId = resource.id as string

    const opts: UpsertOptions = {
      lambda: this.lambda,
      restApi: this.restApi,
      caller,
      resourceId,
      config: this.config,
      lambdaApi: this.lambda,
      gateway: this.gateway,
      events: this.events
    }

    /**
     * Order is significant
     * Create the method on a resource then integrate the method with the Lambda
     * Once created, allow the API Gateway method to call the Lambda
     * Then deploy the API
     *
     * Upserting is done by attempting to locate the entity and creating it if it is not found
     * Permissions are slightly different in that they are removed and created every time
     */
    await api.upsertMethod(opts)
    await api.upsertMethodResponse(opts)
    await api.upsertIntegration(opts)
    await api.upsertIntegrationResponse(opts)
    await api.upsertAPIPermission(opts)

    await this.upsertDeployment(lambda)
  }

  private async deployEventCaller(caller: EventCaller, lambda: AWS.Lambda.FunctionConfiguration) {
    const opts: UpsertOptions = {
      lambda: this.lambda,
      restApi: this.restApi,
      caller,
      resourceId: '',
      config: this.config,
      lambdaApi: this.lambda,
      gateway: this.gateway,
      events: this.events
    }

    await event.upsertEventPermission(opts)
    await event.upsertEventRule(opts)
    await event.upsertTarget(opts)
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

  private clean() {
    this.resourceMap = {}
  }
}
