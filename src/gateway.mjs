import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const AUTH_PATH = '/__dsh_gateway/auth';
const COOKIE_PREFIX = 'dsh-auth-';
const MAX_AUTH_BODY_BYTES = 4096;
const commonHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export function publicPairingUrl(localUrl, publicOrigin) {
  const local = validateLocalAuthenticationUrl(localUrl);
  const target = new URL(publicOrigin);
  target.pathname = '/';
  target.hash = new URLSearchParams({ token: local.searchParams.get('token') }).toString();
  return target.href;
}

export async function startGateway({ port, upstreamUrl, publicOrigin }) {
  const local = validateLocalAuthenticationUrl(upstreamUrl);
  const expectedAuthority = new URL(publicOrigin).host;
  const expectedOrigin = new URL(publicOrigin).origin;
  const launchToken = local.searchParams.get('token');
  const upstream = { hostname: local.hostname, port: Number(local.port) };

  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== expectedAuthority) {
        response.writeHead(403, commonHeaders).end();
        return;
      }
      const url = new URL(request.url ?? '/', expectedOrigin);
      if (url.pathname === AUTH_PATH) {
        await exchangeToken(request, response, { launchToken, upstream, expectedAuthority, expectedOrigin });
        return;
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/' && !hasDshCookie(request.headers.cookie)) {
        response.writeHead(200, {
          ...commonHeaders,
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
          'content-type': 'text/html; charset=utf-8',
        }).end(request.method === 'HEAD' ? undefined : bootstrapPage);
        return;
      }
      proxyHttp(request, response, upstream);
    } catch {
      if (!response.headersSent) response.writeHead(500, commonHeaders);
      response.end();
    }
  });

  server.on('upgrade', (request, socket, head) => {
    if (request.headers.host !== expectedAuthority) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    proxyUpgrade(request, socket, head, upstream);
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolvePromise, rejectPromise) => server.close(error => error ? rejectPromise(error) : resolvePromise())),
  };
}

async function exchangeToken(request, response, context) {
  if (request.method !== 'POST' || request.headers.origin !== context.expectedOrigin ||
      !request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    response.writeHead(403, commonHeaders).end();
    return;
  }
  const body = await readBody(request);
  let supplied;
  try { supplied = JSON.parse(body).token; } catch { supplied = undefined; }
  if (typeof supplied !== 'string' || !tokensMatch(supplied, context.launchToken)) {
    response.writeHead(401, commonHeaders).end();
    return;
  }
  const upstreamResponse = await upstreamRequest({
    ...context.upstream,
    method: 'GET',
    path: `/?token=${encodeURIComponent(context.launchToken)}`,
    headers: { host: context.expectedAuthority },
  });
  const cookie = upstreamResponse.headers['set-cookie'];
  if (upstreamResponse.statusCode !== 303 || !cookie) {
    upstreamResponse.resume();
    response.writeHead(502, commonHeaders).end();
    return;
  }
  upstreamResponse.resume();
  response.writeHead(204, { ...commonHeaders, 'set-cookie': cookie }).end();
}

function proxyHttp(request, response, upstream) {
  const forwarded = http.request({
    ...upstream,
    method: request.method,
    path: request.url,
    headers: request.headers,
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  forwarded.once('error', () => {
    if (!response.headersSent) response.writeHead(502, commonHeaders);
    response.end();
  });
  request.pipe(forwarded);
}

function proxyUpgrade(request, socket, head, upstream) {
  const forwarded = http.request({
    ...upstream,
    method: request.method,
    path: request.url,
    headers: request.headers,
  });
  forwarded.once('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const headers = Object.entries(upstreamResponse.headers)
      .flatMap(([name, value]) => Array.isArray(value) ? value.map(item => `${name}: ${item}`) : value === undefined ? [] : [`${name}: ${value}`]);
    socket.write(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  forwarded.once('response', response => {
    response.resume();
    socket.end(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? 'Bad Gateway'}\r\nConnection: close\r\n\r\n`);
  });
  forwarded.once('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
  forwarded.end();
}

function upstreamRequest(options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = http.request(options, resolvePromise);
    request.once('error', rejectPromise);
    request.end();
  });
}

function readBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_AUTH_BODY_BYTES) request.destroy(new Error('authentication payload too large'));
      else chunks.push(chunk);
    });
    request.once('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    request.once('error', rejectPromise);
  });
}

function tokensMatch(actual, expected) {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function hasDshCookie(value = '') {
  return value.split(';').some(part => part.trim().startsWith(COOKIE_PREFIX));
}

function validateLocalAuthenticationUrl(value) {
  const local = value instanceof URL ? value : new URL(value);
  if (local.protocol !== 'http:' || local.username || local.password || local.hash ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname) || local.pathname !== '/' ||
      local.searchParams.getAll('token').length !== 1 || [...local.searchParams.keys()].some(key => key !== 'token')) {
    throw new Error('DSH returned an unexpected authentication URL');
  }
  return local;
}

const bootstrapPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 DSH</title><style>body{font:16px system-ui;margin:0;background:#f5f7f6;color:#17231e}.card{max-width:420px;margin:12vh auto;padding:24px;background:white;border-radius:20px;box-shadow:0 8px 30px #173c2c18}.muted{color:#617069}button{width:100%;padding:13px 16px;border:0;border-radius:12px;background:#174c3d;color:white;font:inherit}</style></head><body><main class="card"><h1>连接 DSH</h1><p id="status">正在完成安全连接…</p><p class="muted">如果页面没有继续，请回到电脑上的“DSH 手机入口”重新扫码。</p><button id="retry" hidden>重新连接</button></main><script>(()=>{const status=document.getElementById('status');const retry=document.getElementById('retry');const connect=async()=>{const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'','/');if(!token){status.textContent='需要从电脑管理页重新扫码。';return}try{const response=await fetch('${AUTH_PATH}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw new Error();location.replace('/')}catch{status.textContent='连接失败，请回到电脑管理页重新扫码。';retry.hidden=false}};retry.onclick=()=>location.reload();void connect()})()</script></body></html>`;
