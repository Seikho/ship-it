import * as http from 'http'
import * as Lambda from 'aws-lambda'
import * as querystring from 'querystring'

export function get(event: any, context: Lambda.Context, callback) {
  if (event.querystring) {
    querystring.parse(event.querystring)
  }

  http.request({
    host: 'geddit.lol',
    path: `/quote/${event.quoteId}`,
    headers: {
      'Accept': 'application/json'
    },
    method: 'GET',
  }, res => {
    let buffer = ''
    res.on('data', data => {
      buffer += data.toString()
    })

    res.on('end', () => {
      const result = JSON.parse(buffer)
      if (querystring) {
        result.query = event.querystring
      }
      callback(null, result)
    })
  }).end()
}
