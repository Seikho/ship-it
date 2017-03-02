import { Lambda, APICaller, Caller, EventCaller, DeployerConfiguration, UpsertOptions, ResourceOpts } from './types'
import { validateConfig, validateLamda, zip } from './util'
import deployLambda from './lambda'
import * as AWS from 'aws-sdk'
import * as log from './log'

import * as resource from './resource'
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

  private handlers: Array<Lambda> = []
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

  register(lambda: Lambda) {
    validateLamda(lambda)
    lambda.functionName = `${this.config.stageName}-${lambda.functionName}`
    this.handlers.push(lambda)
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
    this.config.apiName = `${this.config.stageName}-${this.config.apiName}`

    this.clean()

    try {
      this.semaphor = true

      /**
       * Create the RestAPI (API)
       * Ensure each Resource (route path) exists in the API
       * Then deploy each registered API Caller
       */

      const opts: ResourceOpts = {
        config: this.config,
        gateway: this.gateway,
        resourceMap: this.resourceMap,
        restApi: this.restApi
      }

      const hasApiCallers = this.handlers.some(handler => handler.caller.kind === 'api')
      if (hasApiCallers) {
        const result = await resource.upsertRestAPI(opts)
        this.resourceMap = result.resourceMap
        this.restApi = result.restApi
      }

      for (const handler of this.handlers) {
        const archive = await zip(handler)
        const lambdaConfig = await deployLambda(this.lambda, handler, this.config.role, archive)

        const caller = handler.caller
        if (caller.kind === 'api') {
          await resource.upsertResource(caller.path, opts)
          await this.deployAPICaller(caller, lambdaConfig)
        } else {
          await this.deployEventCaller(caller, lambdaConfig)
        }
      }

    } finally {
      this.semaphor = false
    }
  }


  private async deployAPICaller(caller: APICaller, lambda: AWS.Lambda.FunctionConfiguration) {

    // Assumed to exist at this point
    // This is run after upsertResource
    const resource = this.resourceMap[caller.path]
    const resourceId = resource.id as string

    const opts: UpsertOptions = {
      lambda,
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
    const description = `${this.config.stageName}: ${lambda.FunctionName}`

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

process.on('unhandledRejection', err => console.log(err))