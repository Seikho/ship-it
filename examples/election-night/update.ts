import * as Lambda from 'aws-lambda'

export function poll(event: Lambda.APIGatewayEvent, context: Lambda.Context, callback: Lambda.Callback) {
  callback(undefined, { event, context })
}
