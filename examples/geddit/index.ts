import Deployer from '../../src'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({
  path: path.resolve(__dirname, '..', '..', '.env')
})

const deployer = new Deployer({
  apiName: 'GedditQuoteFetcher'
})

deployer.register({
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

deployer.deploy()