import * as AWS from 'aws-sdk'
import * as Zip from 'adm-zip'
import { Lambda } from './types'

export interface Options {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export default class Deployer {
  private handlers: Array<Lambda & { archive: Buffer }> = []
  private semaphor = false

  private gateway = new AWS.APIGateway({
    apiVersion: '2015-07-09'
  })

  private lambda = new AWS.Lambda({
    apiVersion: '2015-03-31'
  })

  restApis: AWS.APIGateway.RestApi[] = []

  private events = new AWS.CloudWatchEvents({
    apiVersion: '2015-10-07'
  })

  constructor(awsOptions: Options) {
    AWS.config.update(awsOptions)
  }

  register(lambda: Lambda) {
    const zip = new Zip()
    const {
      folders = [],
      files = []
    } = lambda

    for (const folder of folders) {
      zip.addLocalFolder(folder)
    }

    for (const file of files) {
      zip.addLocalFile(file)
    }

    const entries = zip.getEntries()
    const hasNoFiles = entries.every(entry => entry.isDirectory)
    if (hasNoFiles) {
      throw new HandlerError(`Provided files and folders has no files`, lambda.functionName)
    }

    this.handlers.push({
      ...lambda,
      archive: zip.toBuffer()
    })
  }

  async deploy() {
    if (this.semaphor) {
      throw new DeployError('Already deploying')
    }

    this.clean()

    try {
      this.semaphor = true

      for (const handler of this.handlers) {
        deployLambda(this.lambda, handler)
      }

    } finally {
      this.semaphor = false
    }
  }

  private async getGateway(name: string) {
    if (this.restApis.length === 0) {
      // TODO: Does this throw?
      const restApis = await this.gateway
        .getRestApis({ limit: 0 })
        .promise()

      if (restApis.items) {
        this.restApis = restApis.items
      }
    }

    return this.restApis.find(api => api.name === name)
  }

  private clean() {
    this.restApis = []
  }
}

class DeployError extends Error {
  constructor(message: string) {
    super(`Unable to deploy: ${message}`)
  }
}

class HandlerError extends Error {
  constructor(message: string, name: string) {
    super(`Invalid handler '${name}': ${message}`)
  }
}