import * as AWS from 'aws-sdk'
import { DeployerConfiguration } from './types'
import * as log from './log'

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