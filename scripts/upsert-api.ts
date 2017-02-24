import * as AWS from 'aws-sdk'

const gateway = new AWS.APIGateway({
  apiVersion: '2015-07-09'
})

async function upsert() {
  const api = await getApi()
  let result = {}
  if (api) {
    result = await gateway.updateRestApi({
      restApiId: api.id,
      patchOperations: [
        // ...
      ]
    }).promise()
  } else {
    result = await gateway.createRestApi({
      name: process.env.AWS_API_NAME
    })
  }

  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

async function createApi() {
  const result = await gateway.createRestApi({
    name: process.env.AWS_API_NAME,
  }).promise()
  return result
}

async function createResources(apiId: string) {
  const resources = await getApiResources(apiId)

}

async function getApi(): Promise<AWS.APIGateway.RestApi | undefined> {
  const apis = await gateway.getRestApis({
    limit: 0
  }).promise()

  return apis
    .items
    .find(api => api.name === process.env.AWS_API_NAME)
}

async function getApiResources(apiId: string) {
  const resources = await gateway.getResources({
    restApiId: apiId
  }).promise()
  return resources
}