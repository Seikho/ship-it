import * as http from 'http'
import { LambdaEvent } from '../../src/types'

export function get(event: LambdaEvent, context, callback) {
  http.request({
    host: 'geddit.lol',
    path: `/quote/${event.params.quoteId}`,
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
      if (res.statusCode !== 200) {
        return callback({ statusCode: res.statusCode, message: res.statusMessage }, event)
      }

      const result = JSON.parse(buffer)
      callback(null, {
        result,
        event
      })

    })
  }).end()
}
