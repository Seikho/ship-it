import * as AWS from 'aws-sdk'

export interface Lambda {
  /**
   * Formal Lambda function name
   * Must be unique
   */
  functionName: string

  /**
   * Human readable description of the Lambda function
   */
  description: string

  /**
   * [filename].[function].
   * E.g. 'index.handler'
   * Where:
   * - 'index.js' is in the root of the archive
   * - 'handler' is exported as 'export function handler(...)'
   */
  handler: string

  // Defaults to 128
  memorySize?: number

  // Defaults to 15
  timeout?: number

  /**
   * Environment variables for the Lambda function at run-time
   */
  environment?: { [key: string]: string }

  /**
   * Absolute paths to the files to be included in the zip file
   */
  files: string[]

  /**
   * VPC configuration associated with the Lambda function
   */
  vpcConfig?: {
    subnetIds: string[],
    securityGroupIds: string[],
    vpcId: string
  }
}

export interface BaseDeployer {
  registerLambda(lambda: Lambda): RegisteredLambda
  registerCaller(caller: Caller): void
  deploy(): Promise<void>
}

export interface RegisteredLambda extends Lambda {
  id: number
}

export type Caller = APICaller | EventCaller

interface BaseCaller {

  /**
   * The Lambda function this handler will call
   */
  lambda: RegisteredLambda
}

export interface DeployedLambda {
  lambda: RegisteredLambda
  configuration: AWS.Lambda.FunctionConfiguration
}

export interface APICaller extends BaseCaller {
  kind: 'api'

  /**
   * HTTP Method
   * E.g. GET, POST, PUT, DELETE, PATCH, ...
   */
  method: string

  /**
   * Full resource path from root
   * E.g. /quote/42
   */
  path: string

  /**
   * Content-Type header
   * E.g. application/json, binary/octet-stream
   */
  contentType: string
}

export interface EventCaller extends BaseCaller {
  kind: 'event'

  /**
   * Name of the event
   * E.g. my-schedule-event
   */
  name: string

  /**
   * Human readable description of the event
   * E.g. "Hourly update trigger"
   */
  description: string

  /**
   * Cron or Rate expression
   * See: http://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html
   */
  schedule: string
}

export interface DeployerConfiguration {
  /**
   * Name of the REST API
   * E.g. MyCoolRestAPI
   */
  apiName: string

  /**
   * Deployment stage
   * E.g. dev, uat, stg, prod
   */
  stageName: string

  /**
   * AWS Region
   */
  region: string

  /**
   * AWS Access Key ID
   */
  accessKeyId: string

  /**
   * AWS Secret Access Key
   */
  secretAccessKey: string

  /**
   * AWS Account ID
   */
  accountId: string

  /**
   * IAM Role for the Lambda function
   */
  role: string
}

export type UpsertOptions = {
  resourceId: string
  config: DeployerConfiguration
  caller: Caller
  lambda: AWS.Lambda.FunctionConfiguration
  restApi: AWS.APIGateway.RestApi
  lambdaApi: AWS.Lambda
  gateway: AWS.APIGateway
  events: AWS.CloudWatchEvents
}

export type ResourceMap = { [path: string]: AWS.APIGateway.Resource }

export type ResourceOpts = {
  gateway: AWS.APIGateway,
  config: DeployerConfiguration
  restApi: AWS.APIGateway.RestApi
  resourceMap: ResourceMap
}