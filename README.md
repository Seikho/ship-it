# Project SHIPIT: AWS REST Lambda Deployment

## Purpose
The purpose of this library is to create small projects or services that have their deployment configuration baked in.

This is to minimise the configuration necessary on Continuous Integration (CI) platforms such as Jenkins,
but to still retain a sane deployment with staged environments.

## Gotchas

### Names are Important

The names are important for maintaing the link between `Deployer` consumption and services on AWS.

If the Lambda function or API name are renamed, artifacts will remain on AWS that may be running that are not intended.

If this happens the services must be removed by using the AWS Console (user interface) or by other means.

### Lambdas / RestAPIs must not be shared between projects and `Deployer` instances

**Policies, permissions, and RestAPI resources are deleted during each `.deploy()` call**

**Ensure that RestAPIs (names) and Lambda (names) are not shared between projects and other instances of the `Deployer`.**

## Release Notes

#### v0.5.0
- [Feature] Add support for Lambda VPC configuration

#### v0.4.0
- [Feature] Add support for Lambda run-time environment variables

#### v0.3.0
- [Breaking] Delete all APIGateway resources and Lambda policies at the beginning of each deploy

#### v0.2.x
- [Bugfix] Fix config validation log messages
- [Bugfix] Fix CloudWatchEvent.putTargets call

#### v0.2.0
- [Feature/Breaking] Make Lambdas re-usable between callers
- [Feature] Fallback to environment for Deployer config
- [Feature] Support CloudWatchEvents as callers
- [Breaking] Move Lambda registration to `Deployer.registerLambda()`
- [Breaking] Rename `Deployer.register()` to `Deployer.registerCaller()`

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

// This returns a RegisteredLambda object which can be re-used by callers
const lambda = deployer.registerLambda({
  description: 'My Lambda Function',
  files: [path.resolve(__dirname, 'handlers', 'index.js')],
  functionName: 'My-Lambda-Function',
  handler: 'index.handler'
})

deployer.registerCaller({
  kind: 'api',
  lambda, // Needs to be a RegisteredLambda from .registerLambda
  method: 'GET',
  path: '/users/42',
  contentType: 'application/json'
})

deployer.registerCaller({
  kind: 'event',
  lambda,
  name: 'event-name',
  schedule: 'rate(1 minute)', // Is a Schedule expression, See: http://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html
  description: 'Trigger my Lambda'
})

// Is asynchronous
deployer.deploy()
```

#### Deployer

Some configuration will coalesce to specific environment variables:
- `apiName` -> `process.env.AWS_API_NAME`
- `accountId` -> `process.env.AWS_ACCOUNT_ID`
- `region` -> `process.env.AWS_REGION`
- `accessKeyId` -> `process.env.AWS_ACCESS_KEY_ID`
- `secretAccessKey` -> `process.env.AWS_SECRET_ACCESS_KEY`
- `role` -> `process.env.AWS_ROLE`

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

#### Deployer.registerLambda

```ts
function registerLambda(lambda: Lambda): RegisteredLambda
```

```ts
interface RegisteredLambda extends Lambda {
  id: number
}

interface Lambda {
  /**
   * Formal Lambda function name
   * Must be unique
   */
  functionName: string

  /**
   * Human readable description of the Lambda function
   */
  description: string

  /**
   * [filename].[function].
   * E.g. 'index.handler'
   * Where:
   * - 'index.js' is in the root of the archive
   * - 'handler' is exported as 'export function handler(...)'
   */
  handler: string

  // Defaults to 128
  memorySize?: number

  // Defaults to 15
  timeout?: number

  /**
   * Environment variables for the Lambda function at run-time
   */
  environment?: { [key: string]: string }

  /**
   * Absolute paths to the files to be included in the zip file
   */
  files: string[]
}

```

#### Deployer.registerCaller(caller: Caller)

```ts
function registerCaller(caller: Caller): void
```

```ts
type Caller = APICaller | EventCaller
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

  /**
   * Name of the event
   * E.g. my-schedule-event
   */
  name: string

  /**
   * Human readable description of the event
   * E.g. "Hourly update trigger"
   */
  description: string

  /**
   * Cron or Rate expression
   * See: http://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html
   */
  schedule: string
}
```