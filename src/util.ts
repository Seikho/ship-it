import * as Zip from 'jszip'
import * as AWS from 'aws-sdk'
import * as log from './log'
import * as fs from 'fs'
import * as path from 'path'
import { DeployerConfiguration } from './types'
import { Lambda } from './index'

export function validateConfig(config: DeployerConfiguration) {
  let error = false

  const props: Array<keyof DeployerConfiguration> = [
    'accountId',
    'region',
    'accessKeyId',
    'secretAccessKey',
    'apiName',
    'role',
    'stageName'
  ]

  for (const prop of props) {
    if (!config[prop]) {
      log.error(`Invalid configuration: No '${prop}' set`)
      error = true
    }
  }

  if (error) {
    throw new Error('Invalid configuration')
  }

  AWS.config.update({
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey
  })
}

export function getParent(path: string) {
  if (path === '/') {
    return path
  }

  const parts = split(path)
  const parent = '/' + parts
    .slice(0, -1)
    .join('/')

  return parent
}

export function split(path: string) {
  return path
    .split('/')
    .filter(part => !!part)
}

export function validateLamda(lambda: Lambda) {
  let handlerHasMatch = false
  const handlerFilename = lambda
    .handler
    .split('.')[0]

  for (const file of lambda.files) {
    try {
      // If the file does not exist, throw with a meaningful error
      fs.statSync(file)
      const basename = path.basename(file)
      const ext = path.extname(basename)
      const filename = basename.replace(ext, '')
      const isHandler = handlerFilename === filename
      if (isHandler) {
        handlerHasMatch = true
      }
    } catch (ex) {
      throw new Error(`Cannot register Lambda '${lambda.functionName}': ${file} does not exist`)
    }
  }

  if (!handlerHasMatch) {
    throw new Error(`Cannot register Lambda '${lambda.functionName}: Handler filename not found in provided files list`)
  }
}

export async function zip(lambda: Lambda): Promise<Buffer> {
  const zip = new Zip()
  const files = lambda.files

  for (const file of files) {
    const buffer = fs.readFileSync(file)
    zip.file(path.basename(file), buffer)
  }

  const buffer: Buffer = await zip.generateAsync({ type: 'nodebuffer' })
  return buffer
}