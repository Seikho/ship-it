import * as http from 'http'

export function get(event, context, callback) {
  http.request({
    host: 'geddit.lol',
    path: `/quote/${event.path.quoteId}`,
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
      callback(null, result)
    })
  }).end()
}
