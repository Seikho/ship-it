import Deployer from '../../src'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({
  path: path.resolve(__dirname, '..', '..', '.env')
})

const deployer = new Deployer({
  apiName: 'GedditQuoteFetcher',
  accountId: process.env.AWS_ACCOUNT_ID,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  region: process.env.AWS_REGION,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  role: process.env.AWS_ROLE,
  stageName: process.env.STAGE
})

deployer.register({
  caller: {
    kind: 'api',
    method: 'GET',
    path: '/quote/{quoteId}',
    contentType: 'application/json'
  },
  description: 'Geddit Quote 13',
  files: [path.resolve(__dirname, 'quote.js')],
  functionName: 'Geddit-Quote-13',
  handler: 'quote.get'
})

deployer.deploy()
