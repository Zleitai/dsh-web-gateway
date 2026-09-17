import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { resolveDshLauncher, startDsh } from '../src/dsh.mjs';
import { startGateway } from '../src/gateway.mjs';

const home = await mkdtemp(join(tmpdir(), 'dsh-web-gateway-home-'));
const workspace = await mkdtemp(join(tmpdir(), 'dsh-web-gateway-workspace-'));
const authority = 'gateway.integration.test';
const launcher = resolveDshLauncher();
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'mobile-layout');

runDsh(launcher, ['--profile', 'web', '--dump-config']);
runDsh(launcher, ['plugin', '--profile', 'web', 'add', plugin]);

const dsh = startDsh({
  publicOrigin: `https://${authority}`,
  authority,
  workspace,
  dshHome: home,
  dshLauncher: launcher,
  dshPort: 0,
});
let gateway;

try {
  const ready = await dsh.ready;
  const local = ready.localUrl;
  const dshPort = Number(local.port);
  assert(dshPort > 0);
  gateway = await startGateway({ port: 0, upstreamUrl: local, publicOrigin: `https://${authority}` });
  const pairingUrl = gateway.issuePairingUrl();
  assert.equal(new URL(pairingUrl).origin, `https://${authority}`);
  assert.equal(new URL(pairingUrl).hash, '');
  assert.match(new URL(pairingUrl).search, /^\?pair=[A-Za-z0-9_-]{40,}$/);
  assert.doesNotMatch(pairingUrl, /token=/);
  const port = Number(new URL(gateway.url).port);

  const unauthenticated = await request(port, '/api', { host: authority, method: 'POST', body: '{}' });
  assert.equal(unauthenticated.status, 401);

  const bootstrap = await request(port, '/', { host: authority });
  assert.equal(bootstrap.status, 200);
  assert.match(bootstrap.body, /连接 DSH/);
  assert.doesNotMatch(bootstrap.body, /pair=[A-Za-z0-9_-]{20}/);

  const pairing = new URL(pairingUrl);
  const handoff = await request(port, `${pairing.pathname}${pairing.search}`, { host: authority });
  assert.equal(handoff.status, 200);
  assert.match(handoff.body, /正在完成安全连接/);
  const code = pairing.searchParams.get('pair');
  const exchange = await request(port, '/__dsh_gateway/auth', {
    host: authority,
    origin: `https://${authority}`,
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  assert.equal(exchange.status, 204);
  const cookie = exchange.headers['set-cookie']?.[0]?.split(';', 1)[0];
  assert(cookie && !cookie.includes('token='));

  const rejected = await request(port, '/__dsh_gateway/auth', {
    host: authority,
    origin: `https://${authority}`,
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  assert.equal(rejected.status, 401);

  const page = await request(port, '/', { host: authority, cookie });
  assert.equal(page.status, 200);
  assert.match(page.body, /<!doctype html>/i);
  assert.match(page.body, /\/__dsh_mobile_layout\.css/);

  const stylesheet = await request(port, '/__dsh_mobile_layout.css', { host: authority, cookie });
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers['content-type'], /^text\/css/);
  assert.match(stylesheet.body, /role="dialog"/);

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

  console.log('DSH Web Gateway integration passed: 0.1.5-rc.1 capability check, one-time pairing code, mobile layout plugin, trusted Host, local token exchange, authority-bound cookie, authenticated page and WebSocket.');
} finally {
  await gateway?.close();
  await dsh.stop();
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}

function runDsh(launcher, args) {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  if (result.status !== 0) {
    throw new Error(`DSH setup failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

function request(port, path, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const body = options.body ?? '';
    const request = http.request({
      hostname: '127.0.0.1', port, path, method: options.method ?? 'GET',
      headers: {
        Host: options.host,
        ...(options.origin ? { Origin: options.origin } : {}),
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
