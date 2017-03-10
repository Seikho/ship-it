import * as AWS from 'aws-sdk'
import { Lambda } from './types'
import * as log from './log'

export default async function deploy(lambda: AWS.Lambda, handler: Lambda, role: string, archive: Buffer) {
  const exists = await lambdaExists(handler.functionName, lambda)

  const config = {
    FunctionName: handler.functionName,
    Publish: true,
    Runtime: 'nodejs4.3',
    MemorySize: handler.memorySize || 128,
    Timeout: handler.timeout || 15,
    Description: handler.description,
    Role: role,
    Handler: handler.handler,
    Code: { ZipFile: archive },
    Environment: {
      Variables: handler.environment || {}
    },
    VpcConfig: getVpcConfig(handler)
  }

  const codeConfig = {
    FunctionName: handler.functionName,
    Publish: true,
    ZipFile: archive
  }

  if (exists) {
    log.info(`Update Lambda Code '${handler.functionName}'`)
    await lambda.updateFunctionCode(codeConfig)
      .promise()

    delete config.Code
    delete config.Publish

    log.info(`Update Lambda Config '${handler.functionName}'`)
    const functionConfig = await lambda.updateFunctionConfiguration(config)
      .promise()
    log.debug(log.stringify(functionConfig))
    return functionConfig
  }

  log.info(`Create Lambda Function '${handler.functionName}'`)
  const functionConfig = await lambda.createFunction(config).promise()
  log.debug(log.stringify(functionConfig))

  return functionConfig
}

async function lambdaExists(functionName: string, lambda: AWS.Lambda) {
  try {

    // Throws if not found
    await lambda.getFunction({
      FunctionName: functionName
    }).promise()
    return true

  } catch (ex) {
    return false
  }
}

function getVpcConfig(handler: Lambda) {
  const vpcConfig = handler.vpcConfig

  if (!vpcConfig) {
    return {}
  }

  return {
    SubnetIds: vpcConfig.subnetIds,
    SecurityGroupIds: vpcConfig.securityGroupIds
  }
}