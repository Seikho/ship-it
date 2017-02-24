import * as AWS from 'aws-sdk'
import { Lambda, APICaller } from './types'

type Params = {
  lambda: AWS.Lambda.FunctionConfiguration
  handler: Lambda,
  gateway: AWS.APIGateway,
  restApi: AWS.APIGateway.RestApi | undefined
}

export default async function upsert(params: Params) {
  let api = params.restApi
  let { gateway, handler, lambda } = params
  const caller = handler.caller as APICaller

  // Create the APIGateway if it does not exist
  if (!api) {
    // TODO: Error handling
    api = await gateway.createRestApi({
      name: process.env.AWS_API_NAME
    }).promise()
  }

  const resources = await gateway.getResources({
    restApiId: api.id as string
  }).promise()

  const resourceItems = resources.items as AWS.APIGateway.Resource[]

  const urlParts = caller.path.split('/').filter(part => part.length > 0)

  /**
   * First pass: Only support single-part URL paths
   */

  const basePath = '/' + urlParts.slice(0, -1).join('/')
  const rootResource = resourceItems.find(item => item.path === basePath)

  /**
   * TODO:
   * 1. Ensure all base APIGateway.Resources exist
   * E.g. For route '/first/second/:id' ensure:
   * '/first' exists which references root resource as parentId
   * '/second' exists which references '/first' resource id as parent id
   * Upsert '/:id' which references '/second' resource id as parent id
   * Set passed in Lambda function as destination for '/:id' resource id
   */
}
