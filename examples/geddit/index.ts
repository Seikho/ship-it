import Deployer from '../../src'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({
  path: path.resolve(__dirname, '..', '..', '.env')
})

async function deploy() {
  const deployer = new Deployer({
    apiName: 'GedditQuoteFetcher',
    accountId: process.env.AWS_ACCOUNT_ID,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    region: process.env.AWS_REGION,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    role: process.env.AWS_ROLE,
    stageName: process.env.STAGE
  })

  await deployer.register({
    caller: {
      kind: 'api',
      method: 'GET',
      path: '/quote/{quoteId}',
      contentType: 'application/json'
    },
    description: 'Geddit Quotes',
    files: [path.resolve(__dirname, 'quote.js')],
    functionName: 'Geddit-Quotes',
    handler: 'quote.get'
  })

  try {
    await deployer.deploy()
    process.exit(0)
  } catch (ex) {
    console.log(ex.message)
    process.exit(-1)
  }
}

deploy()