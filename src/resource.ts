import { split, getParent } from './util'
import { ResourceMap, ResourceOpts } from './types'
import * as log from './log'



/**
* Rescursively work up each path tree and ensure each resource exists on the API
*/
export async function upsertResource(path: string, opts: ResourceOpts) {
  const { gateway, resourceMap, restApi } = opts

  if (path === '/') {
    // Root is always assumed to exist
    return
  }

  const parentPath = getParent(path)
  let parentResource = resourceMap[parentPath]
  if (!parentResource) {
    await upsertResource(parentPath, opts)
  }

  parentResource = resourceMap[parentPath]

  const resource = resourceMap[path]
  if (resource) {
    // All parent Resources are assumed to exist
    return
  }

  if (!resource) {
    const pathPart = split(path).slice(-1)[0]
    log.info(`Create Resource '${path}'`)
    const newResource = await gateway.createResource({
      pathPart,
      parentId: parentResource.id as string,
      restApiId: restApi.id as string,
    }).promise()
    log.debug(log.stringify(newResource))
    resourceMap[path] = newResource
  }
}

/**
 * Destructive function: Mutates the 'opts' object
 */
export async function upsertRestAPI(opts: ResourceOpts) {
  const { gateway, config } = opts
  /**
   * RestAPIs cannot be fetched by name, so we must get every API and locate it in a list
   */
  const restApiList = await gateway.getRestApis({
    limit: 0
  }).promise()

  const restApis = restApiList.items || []
  const restApi = restApis.find(item => item.name === config.apiName)
  if (restApi) {
    opts.restApi = restApi

    // Delete all resources attached to this RestAPI
    await removeRestAPIResources({ gateway, restApi })
  }

  if (!opts.restApi) {
    log.info(`Create RestAPI '${config.apiName}'`)
    opts.restApi = await gateway.createRestApi({
      name: config.apiName,
    }).promise()
    log.debug(log.stringify(opts.restApi))
  }

  /**
   * Resources cannot be upserted deterministically one-by-one
   * Must fetch the entire resource list and work backwards
   */
  const resources = await gateway.getResources({
    restApiId: opts.restApi.id as string
  }).promise()

  const resourceItems = resources.items as AWS.APIGateway.Resource[]
  const resourceMap = resourceItems.reduce((prev, curr) => {
    if (!curr.path) {
      return prev
    }

    prev[curr.path] = curr
    return prev
  }, {} as ResourceMap)
  opts.resourceMap = resourceMap

  return {
    resourceMap,
    restApi: opts.restApi
  }
}

async function removeRestAPIResources(opts: { gateway: AWS.APIGateway, restApi: AWS.APIGateway.RestApi }) {
  const { gateway, restApi } = opts

  let currentResource: AWS.APIGateway.Resources | null = await gateway.getResources({
    restApiId: restApi.id as string,
    limit: 0
  }).promise()

  const resources: AWS.APIGateway.Resource[] = []
  if (currentResource.items) {
    resources.push(...currentResource.items)
  }

  do {
    const nextResource: AWS.APIGateway.Resources = await gateway.getResources({
      restApiId: restApi.id as string,
      limit: 0,
      position: currentResource.position
    }).promise()

    if (nextResource.items) {
      resources.push(...nextResource.items)
    }

    if (!nextResource.position) {
      currentResource = null
      continue
    }

    currentResource = nextResource
  } while (currentResource)

  for (const resource of resources) {

    // Root path cannot be deleted
    if (resource.path === '/') {
      continue
    }

    log.info(`Delete Resource '${resource.path}'`)
    const result = await gateway.deleteResource({
      restApiId: restApi.id as string,
      resourceId: resource.id as string
    }).promise().catch(err => log.warn(log.stringify(err)))

    if (result) {
      log.debug(log.stringify(result))
    }
  }
}