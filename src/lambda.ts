import * as AWS from 'aws-sdk'
import { Lambda } from './types'
import print from './print'

export default async function deploy(lambda: AWS.Lambda, handler: Lambda, role: string, archive: Buffer) {
  const exists = await lambdaExists(handler.functionName, lambda)
  const config = {
    FunctionName: handler.functionName,
    Publish: true,
    Runtime: 'nodejs4.3',
    MemorySize: handler.memorySize || 128,
    Timeout: handler.timeout || 15,
    Description: handler.description,
    VpcConfig: {},
    Role: role,
    Handler: handler.handler,
    Code: { ZipFile: archive }
  }

  const codeConfig = {
    FunctionName: handler.functionName,
    Publish: true,
    ZipFile: archive
  }

  if (exists) {

    await print(lambda.updateFunctionCode(codeConfig)
      .promise(), `Update Lambda Code '${handler.functionName}'`)

    delete config.Code
    delete config.Publish
    return await print(lambda.updateFunctionConfiguration(config)
      .promise(), `Update Lambda Config '${handler.functionName}'`)
  }

  return await print(lambda.createFunction({
    ...config,
    Runtime: 'nodejs4.3',
    MemorySize: handler.memorySize || 128,
    Timeout: handler.timeout || 15,
    Description: handler.description,
    VpcConfig: {},
    Role: role,
    Handler: handler.handler,
    Code: { ZipFile: archive }
  }).promise(), `Create Lambda Function '${handler.functionName}'`)
}

async function lambdaExists(functionName: string, lambda: AWS.Lambda) {
  try {

    // Throws if not found
    const result = await lambda.getFunction({
      FunctionName: functionName
    }).promise()
    console.log(result)
    return true
  } catch (ex) {
    console.log(ex)
    return false
  }
}
