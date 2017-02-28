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
  caller: Caller

  // Defaults to 128
  memorySize?: number

  // Defaults to 15
  timeout?: number

  /**
   * Absolute paths to the files to be included in the zip file
   */
  files: string[]
}

export type Caller = APICaller | EventCaller

export interface APICaller {
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

export interface EventCaller {
  kind: 'event'

  /**
   * Name of the event
   * E.g. my-schedule-event
   */
  name: string

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