import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { resolveDshLauncher, startDsh } from '../src/dsh.mjs';

const home = await mkdtemp(join(tmpdir(), 'dsh-web-gateway-home-'));
const workspace = await mkdtemp(join(tmpdir(), 'dsh-web-gateway-workspace-'));
const authority = 'gateway.integration.test';
const dsh = startDsh({
  publicOrigin: `https://${authority}`,
  authority,
  workspace,
  dshHome: home,
  dshLauncher: resolveDshLauncher(),
  port: 0,
});

try {
  const ready = await dsh.ready;
  const local = ready.localUrl;
  const port = Number(local.port);
  assert(port > 0);
  assert.equal(new URL(ready.publicUrl).origin, `https://${authority}`);

  const unauthenticated = await request(port, '/api', { host: authority, method: 'POST', body: '{}' });
  assert.equal(unauthenticated.status, 401);

  const exchange = await request(port, `${local.pathname}${local.search}`, { host: authority });
  assert.equal(exchange.status, 303);
  assert.equal(exchange.headers.location, '/');
  const cookie = exchange.headers['set-cookie']?.[0]?.split(';', 1)[0];
  assert(cookie && !cookie.includes('token='));

  const page = await request(port, '/', { host: authority, cookie });
  assert.equal(page.status, 200);
  assert.match(page.body, /<!doctype html>/i);

  const wrongHost = await request(port, '/api', { host: 'wrong.integration.test', cookie, method: 'POST', body: '{}' });
  assert.equal(wrongHost.status, 403);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/remote.mux`, {
    origin: `https://${authority}`,
    headers: { Host: authority, Cookie: cookie },
    handshakeTimeout: 5000,
  });
  await once(socket, 'open', { signal: AbortSignal.timeout(6000) });
  socket.close();
  await once(socket, 'close', { signal: AbortSignal.timeout(6000) });

  console.log('DSH Web Gateway integration passed: 0.1.5-rc.1 capability check, trusted Host, token exchange, authority-bound cookie, authenticated page and WebSocket.');
} finally {
  await dsh.stop();
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}

function request(port, path, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const body = options.body ?? '';
    const request = http.request({
      hostname: '127.0.0.1', port, path, method: options.method ?? 'GET',
      headers: {
        Host: options.host,
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolvePromise({ status: response.statusCode, headers: response.headers, body: text }));
    });
    request.once('error', rejectPromise);
    request.setTimeout(10000, () => request.destroy(new Error('HTTP request timed out')));
    request.end(body);
  });
}
