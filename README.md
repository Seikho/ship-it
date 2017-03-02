# Project SHIPIT: AWS REST Lambda Deployment

## Purpose
The purpose of this library is to create small projects or services that have their deployment configuration baked in.

This is to minimise the configuration necessary on Continuous Integration (CI) platforms such as Jenkins,
but to still retain a sane deployment with staged environments.

## Usage

### Requirements

**Functional Requirements**
- AWS Account ID
  - Found in AWS Console -> Support -> Support Center -> Top right corner
- AWS API Access
  - AWS secret (Region, Access Key ID, Secret Access Key)
  - AWS Role with full lambda access
  - API Gateway name (User determined, Must be unique)
- Lambda Function names (User determined, Each must be unique)

### API

**Example usage**
```js
import * as path from 'path'
import Deployer from 'ship-it'

const deployer = new Deployer({
  apiName: 'My Rest API',
  accountId: '1234567890',
  region: 'ap-southest-2',
  accessKeyId: '....',
  secretAccessKey: '....',
  role: 'arn:aws:iam::1234567890:role/some-role-name'
})

deployer.register({
  description: 'My Lambda Function',
  files: [path.resolve(__dirname, 'handlers', 'index.js')],
  functionName: 'My-Lambda-Function',
  handler: 'index.handler'
  caller: {
    kind: 'api', // Only 'api' is currently supported
    method: 'GET',
    path: '/users/42',
    contentType: 'application/json'
  }
})

// Is asynchronous
deployer.deploy()
```

#### Deployer

```ts
interface ConstructorParams {

  // Must be unique
  apiName: string

  // Found in AWS console
  accountId: string

  // AWS Region
  region: string

  // Provided by AWS when creating an API key pair
  accesskeyId: string

  // Provided by AWS when creating an API key pair
  secretAccessKey: string

  // Provided by AWS when creating an IAM role
  role: string
}
constructor(params: ConstructorParams)
```

#### Deployer.register

```ts
interface RegisterOptions {
  // Human readable description of the Lambda
  description: string

  // Files that will be uploaded to AWS and available to the Lambda function
  // Each file will be at that root level of the zip file
  // All filenames must be unique
  files: string[]

  // Name of the Lambda Function
  // Must be unique
  functionName: string

  // The handler (entry point) that will be called by the Lambda function
  // Filename (with no extension) and name of the handler function
  // filename.handler
  handler: string

  // Caller details for the RestAPI that will call the Lambda
  caller: APICaller | EventCaller
}

```

```ts
interface APICaller {
    // 'event' will be supported in the future
    kind: 'api'

    // HTTP Method of the caller
    // 'GET', 'PUT', 'POST', 'DELETE', ...
    method: string

    // Route path of the resource
    // E.g. /users
    path: string

    // Return Content-Type of the Lambda
    // E.g. application/json
    contentType: string
}
```
```ts
interface EventCaller {
    kind: 'event'

    // Name of the event
    name: string

    // Cron or Rate expression
    // See: http://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html
    schedule: string
}
```

## Gotchas

The names are important for maintaing the link between `Deployer` consumption and services on AWS.

If the Lambda function or API name are renamed, artifacts will remain on AWS that may be running that are not intended.

If this happens the services must be removed by using the AWS Console (user interface) or by other means.

## TODO
- ~~Add `CloudWatchEvents` caller support~~
- Log service (method, resource, integrations, ...) IDs as they are created or referenced
- ~~Authorized API callers~~ `wontfix`