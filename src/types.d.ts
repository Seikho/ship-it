export interface Handler {
  name: string
  handler: string
  role: string
  folders?: string[]
  files?: string[]
  lambdaOverrides: Partial<AWS.Lambda.CreateFunctionRequest>
  caller: Caller
}

export interface Lambda {
  functionName: string
  handler: string
  archive: Buffer
}

export type Caller = APICaller | EventCaller

export interface APICaller {
  kind: 'api'
  method: 'GET' | 'PUT' | 'POST' | 'DELETE'
  path: string
  gatewayName: string
}

export interface EventCaller {
  kind: 'event'
  name: string
  schedule: string
}