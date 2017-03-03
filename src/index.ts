import { Lambda, APICaller, Caller, EventCaller, DeployerConfiguration, UpsertOptions, ResourceOpts, RegisteredLambda, DeployedLambda } from './types'
import { validateLamda, zip } from './util'
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

  private handlers: Array<RegisteredLambda> = []
  private callers: Array<Caller> = []
  private semaphor = false
  private stageTester = /^[a-zA-Z0-9]+$/

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

  private config: DeployerConfiguration = {
    accessKeyId: '',
    accountId: '',
    apiName: '',
    region: '',
    role: '',
    secretAccessKey: '',
    stageName: ''
  }

  constructor(config: Partial<DeployerConfiguration>) {
    this.config = {
      ...this.config,
      ...config
    }
  }

  registerLambda(lambda: Lambda) {
    validateLamda(lambda)
    const id = this.handlers.length + 1
    const registered = {
      id,
      ...lambda
    }

    this.handlers.push(registered)

    // Return a shallow clone of the Lambda to prevent accidental manipulation
    return Object.freeze({ ...registered })
  }

  registerCaller(caller: Caller) {
    this.callers.push(caller)
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
    this.validateConfig()
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

      const hasApiCallers = this.callers.some(caller => caller.kind === 'api')
      if (hasApiCallers) {
        const result = await resource.upsertRestAPI(opts)
        this.resourceMap = result.resourceMap
        this.restApi = result.restApi
      }

      const deployedLambas: DeployedLambda[] = []
      for (const handler of this.handlers) {
        const archive = await zip(handler)
        handler.functionName = `${this.config.stageName}-${handler.functionName}`

        const lambdaConfig = await deployLambda(this.lambda, handler, this.config.role, archive)
        deployedLambas.push({
          lambda: handler,
          configuration: lambdaConfig
        })
      }

      for (const caller of this.callers) {
        const lambda = deployedLambas.find(func => func.lambda.id === caller.lambda.id) as DeployedLambda
        if (caller.kind === 'api') {
          await resource.upsertResource(caller.path, opts)
          await this.deployAPICaller(caller, lambda.configuration)
        } else {
          await this.deployEventCaller(caller, lambda.configuration)
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
      lambda,
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

  private validateConfig() {
    let error = false

    type Prop = {
      key: keyof DeployerConfiguration,
      env: string
    }
    const props: Array<Prop> = [
      { key: 'accountId', env: 'AWS_ACCOUNT_ID' },
      { key: 'region', env: 'AWS_REGION' },
      { key: 'accessKeyId', env: 'AWS_ACCESS_KEY_ID' },
      { key: 'secretAccessKey', env: 'AWS_SECRET_ACCESS_KEY' },
      { key: 'apiName', env: 'AWS_API_NAME' },
      { key: 'role', env: 'AWS_ROLE' },
      { key: 'stageName', env: 'APP_ENV' }
    ]

    for (const prop of props) {
      const value = this.config[prop.key] || process.env[prop.env]
      if (!value) {
        log.error(`Invalid configuration: No '${prop}' set`)
        error = true
      }

      this.config[prop.key] = value
    }

    if (this.config.stageName) {
      const isValidStageName = this.stageTester.test(this.config.stageName)
      if (!isValidStageName) {
        log.error(`Invalid configuration: Stage name must contain only alphanumeric characters`)
      }
      error = true
    }

    if (error) {
      throw new Error('Invalid configuration')
    }

    AWS.config.update({
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey
    })
  }
}

process.on('unhandledRejection', err => console.log(err))