// Local test fixture only. Never packaged or deployed with the relay.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { HostStore } from '../packages/host/src/store.js';
import { HostController } from '../packages/host/src/controller.js';
import { HostTransport } from '../packages/host/src/transport.js';
import { createRelay } from '../apps/relay/src/server.js';
import { ready } from '../packages/protocol/src/index.js';
import { FakeHarness } from './fake-harness.js';
await ready;
const fixtureHome = await mkdtemp(join(tmpdir(), 'dsh-mobile-browser-'));
const relayOptions = { database: join(fixtureHome, 'relay.sqlite'), allowedOrigins: ['http://127.0.0.1:5173'] };
let relay = createRelay(relayOptions);
await relay.app.listen({ port: 4099, host: '127.0.0.1' });
const registration = (await relay.app.inject({ method: 'POST', url: '/v1/hosts', payload: {} })).json();
const store = new HostStore(':memory:'); const harness = new FakeHarness();
const controller = new HostController(store, harness); controller.share([harness.workspace.id]);
const transport = new HostTransport(controller, 'http://127.0.0.1:4099', registration); transport.start();
harness.onPrompt = (sessionId, text) => {
 void (async () => {
  harness.append(sessionId, 'assistant/chunk', '正在处理：');
  await new Promise(r => setTimeout(r, 120));
  if (text.includes('审批')) {
   const answer = await controller.interactions.ask({ sessionId, kind: 'approval', toolName: '演示工具', reason: '测试单次审批，不执行任何命令。' }, undefined, async () => 'unavailable');
   harness.append(sessionId, 'assistant/message', answer === 'allowed-once' ? '审批已通过，任务完成。' : '已拒绝这次操作。');
  } else harness.append(sessionId, 'assistant/message', '电脑已收到：' + text);
  harness.running.delete(sessionId);
 })().catch(() => {});
};
const admin = createServer(async (req, res) => {
 res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
 const path = req.url;
 if (path === '/fixture') {
  const pair = controller.pair(registration.hostId, 'http://127.0.0.1:4099');
  res.end(JSON.stringify({ url: 'http://127.0.0.1:5173/#pair=' + encodeURIComponent(JSON.stringify(pair)), pending: controller.pending(), sends: harness.sends }));
 } else if (path === '/pending') res.end(JSON.stringify(controller.pending()));
 else if (path === '/confirm' && req.method === 'POST') { for (const p of controller.pending()) controller.confirm(p.id, true); res.end('{}'); }
 else if (path === '/revoke' && req.method === 'POST') { for (const d of store.devices()) controller.revoke(d.id); res.end('{}'); }
 else if (path === '/disconnect' && req.method === 'POST') { await transport.stop(); setTimeout(() => transport.start(), 200); res.end('{}'); }
 else if (path === '/restart-relay' && req.method === 'POST') { await relay.app.close(); relay = createRelay(relayOptions); await relay.app.listen({ port: 4099, host: '127.0.0.1' }); res.end('{}'); }
 else if (path === '/state') res.end(JSON.stringify({ sends: harness.sends, sessions: harness.histories.size }));
 else { res.statusCode = 404; res.end('{}'); }
});
admin.listen(4101, '127.0.0.1', () => console.log('Local browser test fixture ready on 4101'));
async function close() { controller.close(); await transport.stop(); await relay.app.close(); admin.close(); store.close(); if (dirname(resolve(fixtureHome)) === resolve(tmpdir())) await rm(fixtureHome, { recursive: true, force: true }); process.exit(); }
process.on('SIGTERM', close); process.on('SIGINT', close);
