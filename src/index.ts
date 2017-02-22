import * as http from 'http'

export function ingest() {
  http.request({
    host: 'geddit.lol',
    path: '/quote/13',
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
      console.log(buffer)
    })
  }).end()
}
