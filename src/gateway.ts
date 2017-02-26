import * as AWS from 'aws-sdk'
import { Handler } from './types'

type Pair = {
  lambda: AWS.Lambda.FunctionConfiguration,
  handler: Handler
}

type Params = {
  pairs: Pair[]
  gateway: AWS.APIGateway,
  restApi: AWS.APIGateway.RestApi | undefined
}

type ResourceMap = { [path: string]: AWS.APIGateway.Resource }

export default class ResourceCreator {
  gateway: AWS.APIGateway
  resourceMap: ResourceMap = {}
  pairs: Pair[] = []
  restApi: AWS.APIGateway.RestApi

  constructor(params: Params) {
    this.gateway = params.gateway
    this.pairs = params.pairs

    if (params.restApi) {
      this.restApi = params.restApi
    }
  }

  async deploy() {
    if (!this.restApi) {
      // TODO: Error handling
      this.restApi = await this.gateway.createRestApi({
        name: process.env.AWS_API_NAME
      }).promise()
    }

    const resources = await this.gateway.getResources({
      restApiId: this.restApi.id as string
    }).promise()

    const resourceItems = resources.items as AWS.APIGateway.Resource[]
    this.resourceMap = resourceItems.reduce((prev, curr) => {
      if (!curr.path) {
        return prev
      }
      prev[curr.path] = curr
      return prev
    }, {} as ResourceMap)

    for (const pair of this.pairs) {
      const { lambda, handler } = pair
      const caller = handler.caller

      if (caller.kind !== 'api') {
        continue
      }

      await this.upsertResource(caller.path)

    }
  }

  async upsertResource(path: string) {
    if (path === '/') {
      // This is assumed to exist
      return
    }

    const parentPath = getParent(path)
    let parentResource = this.resourceMap[parentPath]
    if (!parentResource) {
      await this.upsertResource(parentPath)
    }

    parentResource = this.resourceMap[parentPath]

    const resource = this.resourceMap[path]
    if (resource) {
      // All parent Resources are assumed to exist
      return
    }
    if (!resource) {
      const newResource = await this.gateway.createResource({
        parentId: parentResource.id as string,
        pathPart: path,
        restApiId: this.restApi.id as string
      }).promise()
      this.resourceMap[path] = newResource
    }
  }

  async setResourceDestination(path: string, lambda: AWS.Lambda.FunctionConfiguration) {

    // Assumed to exist at this point
    // This is run after upsertResource
    const resource = this.resourceMap[path]

    // TODO: Set Resource destination to Lambda
  }
}


function getParent(path: string) {
  if (path === '/') {
    return path
  }

  const parts = split(path)
  const parent = '/' + parts
    .slice(0, -1)
    .join('/')

  return parent
}

function split(path: string) {
  return path
    .split('/')
    .filter(part => !!part)
}