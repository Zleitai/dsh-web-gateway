import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { ready, identity } from '../packages/protocol/src/index.js';
import { HostController } from '../packages/host/src/controller.js';
import { HostStore } from '../packages/host/src/store.js';
import { Interactions } from '../packages/host/src/interactions.js';
import { projectRecord } from '../packages/host/src/adapter.js';
import { FakeHarness } from './fake-harness.js';
beforeAll(async () => { await ready; });
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0)) f(); vi.useRealTimers(); });
async function setup() {
 const store = new HostStore(':memory:'); const adapter = new FakeHarness(); const controller = new HostController(store, adapter);
 cleanup.push(() => { controller.close(); store.close(); });
 const phone = identity(); const device = { id: randomUUID(), publicKey: phone.publicKey, name: 'Phone', createdAt: Date.now() }; store.addDevice(device);
 const sessionId = 'session-' + randomUUID(); await adapter.create(adapter.workspace, sessionId);
 const call = (method: string, args = {}, requestId = randomUUID(), key = phone.publicKey) => controller.execute(key, { v: 1, method, requestId, ...args }, new AbortController().signal);
 return { store, adapter, controller, phone, device, sessionId, call };
}
test('unpaired, revoked and unshared access fail; no workspace is shared by default', async () => {
 const x = await setup();
 expect(await x.call('workspaces.list')).toMatchObject({ ok: true, data: [] });
 expect(await x.call('sessions.send', { sessionId: x.sessionId, text: 'hi' })).toMatchObject({ error: { code: 'WORKSPACE_NOT_SHARED' } });
 x.controller.share([x.adapter.workspace.id]);
 expect(await x.call('sessions.send', { sessionId: x.sessionId, text: 'hi' }, undefined, identity().publicKey)).toMatchObject({ error: { code: 'DEVICE_NOT_AUTHORIZED' } });
 x.controller.revoke(x.device.id);
 expect(await x.call('sessions.history', { sessionId: x.sessionId, throughSeq: 0 })).toMatchObject({ error: { code: 'DEVICE_NOT_AUTHORIZED' } });
 expect(x.adapter.sends).toBe(0);
});
test('pairing requires desktop confirmation, is one-use and expires', async () => {
 const x = await setup(); const phone = identity(); const pair = x.controller.pair(randomUUID(), 'http://localhost:4090');
 expect(await x.controller.authorize(phone.publicKey, 'Phone', 'invalid')).toBe(false);
 const authorization = x.controller.authorize(phone.publicKey, 'Phone', pair.token);
 expect(x.controller.device(phone.publicKey)).toBeUndefined();
 expect(await x.controller.authorize(identity().publicKey, 'Attacker', pair.token)).toBe(false);
 x.controller.confirm(x.controller.pending()[0]!.id, true); expect(await authorization).toBe(true);
 expect(await x.controller.authorize(identity().publicKey, 'Other', pair.token)).toBe(false);
 vi.useFakeTimers(); const expired = x.controller.pair(randomUUID(), 'http://localhost:4090'); vi.advanceTimersByTime(300001);
 expect(await x.controller.authorize(identity().publicKey, 'Phone', expired.token)).toBe(false);
});
test('same request executes once; changed payload conflicts; cached creation cannot bypass withdrawn sharing', async () => {
 const x = await setup(); x.controller.share([x.adapter.workspace.id]); const requestId = randomUUID();
 const args = { sessionId: x.sessionId, text: 'once' };
 const replies = await Promise.all([x.call('sessions.send', args, requestId), x.call('sessions.send', args, requestId)]);
 expect(replies[0]).toEqual(replies[1]); expect(x.adapter.sends).toBe(1);
 expect(await x.call('sessions.send', { ...args, text: 'changed' }, requestId)).toMatchObject({ error: { code: 'REQUEST_ID_CONFLICT' } });
 const createId = randomUUID(); await x.call('sessions.create', { workspaceId: x.adapter.workspace.id }, createId);
 x.controller.share([]);
 expect(await x.call('sessions.create', { workspaceId: x.adapter.workspace.id }, createId)).toMatchObject({ error: { code: 'WORKSPACE_NOT_SHARED' } });
});
test('crash-pending receipts reconcile committed history and never resubmit unknown work', async () => {
 const x = await setup(); x.controller.share([x.adapter.workspace.id]);
 for (const committed of [false, true]) {
  const requestId = randomUUID(); const request = { v: 1, requestId, method: 'sessions.send', sessionId: x.sessionId, text: 'once' };
  x.store.begin(x.phone.publicKey + ':' + requestId, createHash('sha256').update(JSON.stringify(request)).digest('hex'));
  if (committed) x.adapter.append(x.sessionId, 'user/message', 'once', requestId);
  const reply = await x.controller.execute(x.phone.publicKey, request, new AbortController().signal);
  expect(reply).toMatchObject(committed ? { ok: true } : { error: { code: 'RESULT_UNCERTAIN' } });
 }
 expect(x.adapter.sends).toBe(0);
});
test('desktop and phone decisions race once and bind exact session and interaction', async () => {
 const i = new Interactions(); let desktop!: (v: unknown) => void;
 const pending = i.ask({ sessionId: 'session-a', kind: 'approval' }, undefined, () => new Promise(r => { desktop = r; }));
 const id = i.list('session-a')[0]!.id;
 expect(() => i.answer('session-b', id, 'allowed-once')).toThrow('INTERACTION_EXPIRED');
 await Promise.resolve(); i.answer('session-a', id, 'rejected'); desktop('allowed-once');
 expect(await pending).toBe('rejected'); expect(() => i.answer('session-a', id, 'allowed-once')).toThrow('INTERACTION_EXPIRED');
 const second = i.ask({ sessionId: 'session-a', kind: 'approval' }, undefined, async () => 'allowed-once');
 await second; expect(i.list('session-a')).toEqual([]);
});
test('projection preserves text-delta and hides reasoning, tools and audit parameters', () => {
 const project = (type: string, data: unknown) => projectRecord({ type: 'event', event: { seq: 1, time: 1, type, data } });
 expect(project('assistant/chunk', { chunk: { type: 'text-delta', text: 'visible' } }).text).toBe('visible');
 expect(project('assistant/chunk', { chunk: { type: 'reasoning-delta', text: 'hidden' } }).text).toBe('');
 expect(project('assistant/message', { message: { content: [{ type: 'text', text: 'visible' }, { type: 'reasoning', text: 'hidden' }] } }).text).toBe('visible');
 expect(project('approval/asked', { reason: 'private args' }).text).toBe('');
});
