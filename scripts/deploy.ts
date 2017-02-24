import * as dotenv from 'dotenv'
import * as path from 'path'
import Deployer from '../src/index'

dotenv.config({
  path: path.resolve(__dirname, '..', '.env')
})

const deployer = new Deployer({
  region: 'ap-southest-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
})

deployer.register({
  name: 'Carl_Geddit-Quote-13',
  handler: 'quote.get',
  files: [path.resolve(__dirname, '..', 'handlers', 'quote.js')],
  role: process.env.AWS_ROLE,
  caller: {
    kind: 'api',
    method: 'GET',
    path: '/quote',
    gatewayName: process.env.AWS_API_NAME
  },
  lambdaOverrides: {}
})

async function deploy() {
  await deploy()
  process.exit(0)
}

deployer.deploy()