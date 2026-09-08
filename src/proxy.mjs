/** Loopback HTTP/WebSocket proxy for authenticated remote access to DSH. */
import http from 'node:http'
import net from 'node:net'

const LISTEN_HOST = '127.0.0.1'
const LISTEN_PORT = 3088
const DSH_HOST = '127.0.0.1'
const DSH_PORT = 3080
const UPSTREAM_AUTHORITY = `${DSH_HOST}:${DSH_PORT}`

const log = (...parts) => console.error(new Date().toISOString(), ...parts)

/** Rewrite Host + Origin so DSH's /api gate accepts the request as loopback. */
function forwardedHeaders(source) {
  const headers = { ...source }
  headers.host = UPSTREAM_AUTHORITY
  if (headers.origin !== undefined) {
    headers.origin = `http://${UPSTREAM_AUTHORITY}`
  }
  return headers
}

const server = http.createServer((request, response) => {
  const start = Date.now()
  const upstream = http.request({
    hostname: DSH_HOST,
    port: DSH_PORT,
    method: request.method,
    path: request.url,
    headers: forwardedHeaders(request.headers),
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })

  response.on('finish', () => {
    log('HTTP', request.method, request.url, '->', response.statusCode, `(${Date.now() - start}ms)`)
  })

  upstream.on('error', err => {
    log('ERR', 'upstream', err.code ?? err.message, `${DSH_HOST}:${DSH_PORT}`)
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('DeepSeek Harness is not ready.')
    } else {
      response.destroy()
    }
  })

  request.on('aborted', () => upstream.destroy())
  request.pipe(upstream)
})

server.on('upgrade', (request, socket, head) => {
  log('WS', request.method ?? 'GET', request.url, 'upgrade')
  const upstream = net.connect(DSH_PORT, DSH_HOST)

  upstream.once('connect', () => {
    const headers = forwardedHeaders(request.headers)
    let wire = `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}\r\n`
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) {
        wire += `${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`
      }
    }
    upstream.write(`${wire}\r\n`)
    if (head.length > 0) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })

  upstream.on('error', err => {
    log('ERR', 'ws upstream', err.code ?? err.message, `${DSH_HOST}:${DSH_PORT}`)
    socket.destroy()
  })
  socket.on('error', () => upstream.destroy())
})

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
})

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log('listening', `http://${LISTEN_HOST}:${LISTEN_PORT}`)
})

function stop() {
  log('shutting down')
  server.close(() => process.exit(0))
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
