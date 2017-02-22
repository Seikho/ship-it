import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import * as AWS from 'aws-sdk'
import * as Zip from 'adm-zip'

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

const gateway = new AWS.APIGateway({
  apiVersion: '2015-07-09'
})

async function deploy() {
  const zip = getSourceBuffer()
  await lambda.createFunction({
    FunctionName: process.env.AWS_FUNCTION_NAME,
    Description: 'AEC Polling Data Ingester',
    Handler: 'index.ingest',
    MemorySize: 128,
    Publish: true,
    Role: process.env.AWS_ROLE,
    Runtime: 'nodejs4.3',
    Timeout: 15,
    VpcConfig: {

    },
    Code: {
      ZipFile: zip
    }
  },
    (err, data) => {
      if (err) {
        console.log(JSON.stringify(err, null, 2))
        process.exit(1)
      }
      console.log(JSON.stringify(data, null, 2))
      process.exit(0)
    }
  ).promise()
}

function getSourceBuffer(): Buffer {
  const archive = new Zip()
  const files = fs.readdirSync(path.resolve(__dirname, '..', 'src'))
    .filter(file => path.extname(file) === '.js')
    .map(file => path.resolve(__dirname, '..', 'src', file))

  for (const file of files) {
    archive.addLocalFile(file)
  }

  const buffer = archive.toBuffer()
  return buffer
}

deploy()