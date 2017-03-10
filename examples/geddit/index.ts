import Deployer from '../../src'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({
  path: path.resolve(__dirname, '..', '..', '.env')
})

const deployer = new Deployer({
  apiName: 'GedditQuoteFetcher'
})

const lambda = deployer.registerLambda({
  description: 'Geddit Quotes',
  files: [path.resolve(__dirname, 'quote.js')],
  functionName: 'Geddit-Quotes',
  handler: 'quote.get'
})

deployer.registerCaller({
  kind: 'api',
  lambda,
  method: 'POST',
  path: '/quote/{quoteId}',
  contentType: 'application/json'
})

deployer.deploy()