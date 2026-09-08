import { beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ready, identity, HostHandshake, PhoneHandshake, requestSchema, endpoint } from '../packages/protocol/src/index.js';
beforeAll(async () => { await ready; });
async function channel() {
  const host = identity(), phone = identity(), id = randomUUID();
  const h = new HostHandshake(host, phone.publicKey, id), p = new PhoneHandshake(phone, host.publicKey, id);
  const auth = p.acceptOffer(h.offer(), 'Phone');
  const accepted = await h.accept(auth, async () => true);
  return { host: accepted.stream, phone: p.acceptReady(accepted.reply), h, p, auth, hostKey: host, phoneKey: phone };
}
test('authenticated bidirectional encrypted content; ciphertext contains no plaintext', async () => {
  const c = await channel(); const encrypted = c.phone.encrypt({ text: 'private conversation' });
  expect(JSON.stringify(encrypted)).not.toContain('private conversation');
  expect(c.host.decrypt(encrypted)).toEqual({ text: 'private conversation' });
  expect(c.phone.decrypt(c.host.encrypt({ ok: true }))).toEqual({ ok: true });
});
test('replay, out-of-order, tampering and prior-connection frames fail', async () => {
  const c = await channel(); const first = c.phone.encrypt({ n: 1 });
  expect(c.host.decrypt(first)).toEqual({ n: 1 });
  expect(() => c.host.decrypt(first)).toThrow();
  const d = await channel(); const a = d.phone.encrypt(1), b = d.phone.encrypt(2);
  expect(() => d.host.decrypt(b)).toThrow();
  expect(d.host.decrypt(a)).toBe(1);
  const e = await channel(); const msg = e.phone.encrypt('hello');
  const data = Buffer.from(msg.data, 'base64'); data[0] = data[0]! ^ 1;
  expect(() => e.host.decrypt({ ...msg, data: data.toString('base64') })).toThrow();
  const fresh = await channel(); expect(() => fresh.host.decrypt(first)).toThrow();
});
test('forged identity, mismatched channel, denied authorization, repeated handshake fail', async () => {
  const c = await channel();
  await expect(c.h.accept(c.auth, async () => true)).rejects.toThrow('HANDSHAKE_REPLAY');
  const id = randomUUID(); const host = identity(), phone = identity(), attacker = identity();
  const offer = new HostHandshake(host, phone.publicKey, id).offer();
  expect(() => new PhoneHandshake(phone, attacker.publicKey, id).acceptOffer(offer, 'Phone')).toThrow();
  expect(() => new PhoneHandshake(phone, host.publicKey, randomUUID()).acceptOffer(offer, 'Phone')).toThrow('WRONG_CHANNEL');
  const h = new HostHandshake(host, phone.publicKey, id), p = new PhoneHandshake(phone, host.publicKey, id);
  await expect(h.accept(p.acceptOffer(h.offer(), 'Phone'), async () => false)).rejects.toThrow('NOT_AUTHORIZED');
});
test('protocol rejects extra fields and arbitrary RPC; supports native prefixed session IDs', () => {
  const base = { v: 1, requestId: randomUUID() };
  expect(requestSchema.safeParse({ ...base, method: 'settings.get' }).success).toBe(false);
  expect(requestSchema.safeParse({ ...base, method: 'workspaces.list', token: 'secret' }).success).toBe(false);
  expect(requestSchema.safeParse({ ...base, method: 'sessions.watch', sessionId: 'session-' + randomUUID() }).success).toBe(true);
  expect(() => endpoint('http://public.example', '/')).toThrow('HTTPS_REQUIRED');
  expect(() => endpoint('https://user:secret@example.com', '/')).toThrow();
  expect(endpoint('http://127.0.0.1:4090', '/v1/socket', true)).toBe('ws://127.0.0.1:4090/v1/socket');
});
