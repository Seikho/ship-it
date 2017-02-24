import * as AWS from 'aws-sdk'
import { Lambda } from './types'

export default async function deploy(lambda: AWS.Lambda, handler: Lambda) {
  const exists = await lambdaExists(lambda)
  const config = {
    FunctionName: handler.functionName,
    Publish: true
  }

  if (exists) {
    return await lambda.updateFunctionCode({
      ...config,
      ZipFile: handler.archive
    }).promise()
  }

  return await lambda.createFunction({
    ...config,
    Runtime: 'nodejs4.3',
    MemorySize: handler.memorySize || 128,
    Timeout: handler.timeout || 15,
    Description: handler.description,
    VpcConfig: {},
    Role: handler.role,
    Handler: 'index.ingest',
    Code: { ZipFile: handler.archive }
  }).promise()
}

async function lambdaExists(lambda: AWS.Lambda) {
  try {
    // Throws if not found
    await lambda.getFunction({
      FunctionName: process.env.AWS_FUNCTION_NAME
    }).promise()
    return true
  } catch (_) {
    return false
  }
}
