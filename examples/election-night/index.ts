import Deployer from '../../src'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({
  path: path.resolve(__dirname, '.env')
})

const deployer = new Deployer({
  apiName: 'ElectionNightPollerApi',
  accountId: process.env.AWS_ACCOUNT_ID,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  region: process.env.AWS_REGION,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  role: process.env.AWS_ROLE,
  stageName: 'dougm'
})

deployer.register({
  caller: {
    kind: 'event',
    name: 'election-night-poll-event',
    schedule: 'rate(1 minute)'
  },
  description: 'Election Night Updater',
  files: [path.resolve(__dirname, 'update.js')],
  functionName: 'ElectionNightPollerFunc',
  handler: 'update.poll'
})

deployer.deploy()
