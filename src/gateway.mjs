import http from 'node:http';
import { randomBytes } from 'node:crypto';

const COOKIE_PREFIX = 'dsh-auth-';
const PAIR_QUERY = 'pair';
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
const commonHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export async function startGateway({ port, upstreamUrl, publicOrigin, pairingTtlMs = DEFAULT_PAIRING_TTL_MS }) {
  const local = validateLocalAuthenticationUrl(upstreamUrl);
  const expectedAuthority = new URL(publicOrigin).host;
  const expectedOrigin = new URL(publicOrigin).origin;
  const launchToken = local.searchParams.get('token');
  const upstream = { hostname: local.hostname, port: Number(local.port) };
  const pairingCodes = new Map();

  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== expectedAuthority) {
        response.writeHead(403, commonHeaders).end();
        return;
      }
      const url = new URL(request.url ?? '/', expectedOrigin);
      if (request.method === 'GET' && url.pathname === '/' && url.searchParams.has(PAIR_QUERY)) {
        const codes = url.searchParams.getAll(PAIR_QUERY);
        const validShape = codes.length === 1 && [...url.searchParams.keys()].every(key => key === PAIR_QUERY);
        if (!validShape || !consumePairingCode(pairingCodes, codes[0])) {
          response.writeHead(401, { ...commonHeaders, 'content-type': 'text/html; charset=utf-8' }).end(expiredPage);
          return;
        }
        await exchangeDshSession(response, { launchToken, upstream, expectedAuthority });
        return;
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/' && !hasDshCookie(request.headers.cookie)) {
        response.writeHead(200, {
          ...commonHeaders,
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
          'content-type': 'text/html; charset=utf-8',
        }).end(request.method === 'HEAD' ? undefined : waitingPage);
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
    issuePairingUrl() {
      pruneExpiredCodes(pairingCodes);
      const code = randomBytes(32).toString('base64url');
      pairingCodes.set(code, Date.now() + pairingTtlMs);
      const target = new URL(expectedOrigin);
      target.searchParams.set(PAIR_QUERY, code);
      return target.href;
    },
    close: () => new Promise((resolvePromise, rejectPromise) => server.close(error => error ? rejectPromise(error) : resolvePromise())),
  };
}

async function exchangeDshSession(response, context) {
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
  response.writeHead(303, { ...commonHeaders, 'set-cookie': cookie, location: '/' }).end();
}

function consumePairingCode(codes, code) {
  const expiresAt = codes.get(code);
  codes.delete(code);
  return expiresAt !== undefined && expiresAt > Date.now();
}

function pruneExpiredCodes(codes) {
  const now = Date.now();
  for (const [code, expiresAt] of codes) if (expiresAt <= now) codes.delete(code);
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

const pageStyle = 'body{font:16px system-ui;margin:0;background:#f5f7f6;color:#17231e}.card{max-width:420px;margin:12vh auto;padding:24px;background:white;border-radius:20px;box-shadow:0 8px 30px #173c2c18}.muted{color:#617069}';
const waitingPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 DSH</title><style>${pageStyle}</style></head><body><main class="card"><h1>连接 DSH</h1><p>需要从电脑管理页重新扫码。</p><p class="muted">请回到电脑上的“DSH 手机入口”，刷新页面后扫描新二维码。</p></main></body></html>`;
const expiredPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>二维码已失效</title><style>${pageStyle}</style></head><body><main class="card"><h1>二维码已失效</h1><p>这个二维码已经使用过或超过十分钟。</p><p class="muted">请刷新电脑上的“DSH 手机入口”，再扫描新二维码。</p></main></body></html>`;
