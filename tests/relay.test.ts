import { afterEach, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRelay } from '../apps/relay/src/server.js';
import { HostStore } from '../packages/host/src/store.js';
import { HostController } from '../packages/host/src/controller.js';
import { HostTransport } from '../packages/host/src/transport.js';
import { ready, identity } from '../packages/protocol/src/index.js';
import { FakeHarness } from './fake-harness.js';
import { TestPhone, until } from './wire-client.js';
beforeAll(async () => { await ready; });
const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
async function setup(invite?: string) {
 const relay = createRelay({ database: ':memory:', allowedOrigins: ['http://127.0.0.1:5173'], invite, inviteUses: 1 });
 const url = await relay.app.listen({ port: 0, host: '127.0.0.1' }); cleanup.push(() => relay.app.close());
 const register = (code?: string) => relay.app.inject({ method: 'POST', url: '/v1/hosts', payload: { invite: code } });
 const result = await register(invite); const registration = result.json();
 const store = new HostStore(':memory:'); const harness = new FakeHarness(); const controller = new HostController(store, harness);
 const transport = new HostTransport(controller, url, registration);
 cleanup.push(async () => { await transport.stop(); controller.close(); store.close(); });
 controller.share([harness.workspace.id]); transport.start(); await until(() => transport.state === 'connected');
 const pair = controller.pair(registration.hostId, url);
 return { relay, url, register, store, harness, controller, transport, pair, registration };
}
test('real relay pairing, encrypted RPC, reconnection, revocation and peer attack isolation', async () => {
 const x = await setup('invite-only');
 expect((await x.register('wrong')).statusCode).toBe(403);
 expect((await x.register('invite-only')).statusCode).toBe(403);
 const p = new TestPhone(x.pair); cleanup.push(() => p.close()); const connecting = p.connect();
 await until(() => x.controller.pending().length === 1);
 expect(x.transport.hasPhone()).toBe(false);
 x.controller.confirm(x.controller.pending()[0]!.id, true); await connecting;
 const created = await p.call('sessions.create', { workspaceId: x.harness.workspace.id }); const id = created.data.sessionId;
 await p.call('sessions.watch', { sessionId: id });
 const requestId = randomUUID(); await p.call('sessions.send', { sessionId: id, text: 'confidential text' }, requestId);
 await until(() => p.events.some(e => e.data.records?.some((r: any) => r.text === 'confidential text')));
 expect(JSON.stringify(p.packets)).not.toContain('confidential text');
 p.close();
 const second = new TestPhone(x.pair, p.key); cleanup.push(() => second.close()); await second.connect();
 await second.call('sessions.send', { sessionId: id, text: 'confidential text' }, requestId); expect(x.harness.sends).toBe(1);
 // An authenticated peer's malformed encrypted payload must not close other devices or the host.
 const badKey = identity(); x.store.addDevice({ id: randomUUID(), publicKey: badKey.publicKey, name: 'Bad peer', createdAt: Date.now() });
 const bad = new TestPhone(x.pair, badKey); cleanup.push(() => bad.close()); await bad.connect();
 bad.send({ type: 'stream', data: 'AAAA' }); await until(() => bad.socket.readyState === WebSocket.CLOSED);
 expect(x.transport.state).toBe('connected'); expect((await second.call('workspaces.list')).ok).toBe(true);
 const device = x.store.devices().find(d => d.publicKey === p.key.publicKey)!; x.controller.revoke(device.id);
 await until(() => second.socket.readyState === WebSocket.CLOSED);
 const revoked = new TestPhone(x.pair, p.key); cleanup.push(() => revoked.close());
 await expect(revoked.connect()).rejects.toThrow('CONNECTION_CLOSED');
});
test('host registration forgery fails and offline phones receive retryable close', async () => {
 const x = await setup();
 const forged = new WebSocket(x.url.replace('http', 'ws') + '/v1/socket'); cleanup.push(() => forged.terminate());
 const close = new Promise<number>(r => forged.once('close', code => r(code)));
 forged.on('open', () => forged.send(JSON.stringify({ type: 'hello', role: 'host', hostId: x.registration.hostId, token: 'wrong' })));
 expect(await close).toBe(1008); expect(x.transport.state).toBe('connected');
 await x.transport.stop();
 const phone = new WebSocket(x.url.replace('http', 'ws') + '/v1/socket'); cleanup.push(() => phone.terminate());
 const offline = new Promise<number>(r => phone.once('close', code => r(code)));
 phone.on('open', () => phone.send(JSON.stringify({ type: 'hello', role: 'phone', hostId: x.registration.hostId, publicKey: identity().publicKey })));
 expect(await offline).toBe(4001);
});
test('relay shuts down promptly with live upgraded sockets', async () => {
 const x = await setup();
 await expect(Promise.race([x.relay.app.close().then(() => 'closed'), new Promise(r => setTimeout(() => r('timeout'), 1500))])).resolves.toBe('closed');
});
