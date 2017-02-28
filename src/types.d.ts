export interface Lambda {
  functionName: string
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

  files: string[]
}

export type Caller = APICaller | EventCaller

export interface APICaller {
  kind: 'api'
  method: 'GET' | 'PUT' | 'POST' | 'DELETE'
  path: string
  contentType: string
}

export interface EventCaller {
  kind: 'event'
  name: string
  schedule: string
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