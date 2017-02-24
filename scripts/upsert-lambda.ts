import * as dotenv from 'dotenv'
import * as AWS from 'aws-sdk'
import * as path from 'path'
import getZipBuffer from './zip'

dotenv.config({
  path: path.resolve(__dirname, '..', '.env')
})

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
})

const lambda = new AWS.Lambda({
  apiVersion: '2015-03-31'
})

async function deploy() {
  const zip = getZipBuffer()
  const exists = await lambdaExists()
  const config = {
    FunctionName: process.env.AWS_FUNCTION_NAME,
    Publish: true
  }

  let result = {}
  if (exists) {
    result = await lambda.updateFunctionCode({
      ...config,
      ZipFile: zip
    }).promise()
  } else {
    result = await lambda.createFunction({
      ...config,
      Runtime: 'nodejs4.3',
      MemorySize: 128,
      Timeout: 15,
      Description: 'AEC Polling Data Ingester',
      VpcConfig: {},
      Role: process.env.AWS_ROLE,
      Handler: 'index.ingest',
      Code: { ZipFile: zip }
    }).promise()
  }

  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

async function lambdaExists() {
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

deploy()