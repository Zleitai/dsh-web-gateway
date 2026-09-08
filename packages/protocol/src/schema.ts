import { z } from 'zod';

export const VERSION = 1 as const;
export const MAX_FRAME_BYTES = 512 * 1024;
const id = z.string().uuid();
export const sessionIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const key = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const base = { v: z.literal(VERSION), requestId: id };
export const requestSchema = z.discriminatedUnion('method', [
  z.object({ ...base, method: z.literal('workspaces.list') }).strict(),
  z.object({ ...base, method: z.literal('sessions.list'), workspaceId: id }).strict(),
  z.object({ ...base, method: z.literal('sessions.create'), workspaceId: id }).strict(),
  z.object({ ...base, method: z.literal('sessions.history'), sessionId: sessionIdSchema, throughSeq: z.number().int().nonnegative(), beforeSeq: z.number().int().nonnegative().optional() }).strict(),
  z.object({ ...base, method: z.literal('sessions.watch'), sessionId: sessionIdSchema }).strict(),
  z.object({ ...base, method: z.literal('sessions.unwatch'), sessionId: sessionIdSchema }).strict(),
  z.object({ ...base, method: z.literal('sessions.send'), sessionId: sessionIdSchema, text: z.string().trim().min(1).max(32000) }).strict(),
  z.object({ ...base, method: z.literal('sessions.cancel'), sessionId: sessionIdSchema }).strict(),
  z.object({ ...base, method: z.literal('interactions.list'), sessionId: sessionIdSchema }).strict(),
  z.object({ ...base, method: z.literal('interactions.answer'), sessionId: sessionIdSchema, interactionId: id,
    answer: z.union([z.enum(['allowed-once', 'rejected']), z.object({ answers: z.array(z.object({ id: z.string().max(256), selected: z.array(z.string().max(8192)).max(32), custom: z.string().max(8192).optional() }).strict()).max(20) }).strict()]) }).strict(),
]);
export type RpcRequest = z.infer<typeof requestSchema>;
export type Reply = { v: 1; type: 'response'; requestId: string; ok: true; data: unknown } | { v: 1; type: 'response'; requestId: string; ok: false; error: { code: string; message: string } };
export type Notice = { v: 1; type: 'event'; sessionId: string; topic: 'history' | 'interactions' | 'control'; data: unknown };
export type WireMessage = Reply | Notice;
export const messageSchema = z.union([
  z.object({ v: z.literal(1), type: z.literal('response'), requestId: id, ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ v: z.literal(1), type: z.literal('response'), requestId: id, ok: z.literal(false), error: z.object({ code: z.string().max(100), message: z.string().max(500) }).strict() }).strict(),
  z.object({ v: z.literal(1), type: z.literal('event'), sessionId: sessionIdSchema, topic: z.enum(['history', 'interactions', 'control']), data: z.unknown() }).strict(),
]);
export const pairingSchema = z.object({ v: z.literal(1), hostId: id, hostKey: key, relayUrl: z.string().url(), token: z.string().min(40).max(100), expiresAt: z.number().int() }).strict();
export type Pairing = z.infer<typeof pairingSchema>;
export const relayHelloSchema = z.discriminatedUnion('role', [
  z.object({ type: z.literal('hello'), role: z.literal('host'), hostId: id, token: z.string().max(100) }).strict(),
  z.object({ type: z.literal('hello'), role: z.literal('phone'), hostId: id, publicKey: key }).strict(),
]);
export const envelopeSchema = z.object({ type: z.enum(['box', 'stream']), data: z.string().max(MAX_FRAME_BYTES), nonce: z.string().max(40).optional() }).strict();
export type Envelope = z.infer<typeof envelopeSchema>;

export function parseJson(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_FRAME_BYTES) throw new Error('FRAME_TOO_LARGE');
  return JSON.parse(text) as unknown;
}
export function endpoint(baseUrl: string, path: string, websocket = false): string {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a service origin without credentials or paths');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('HTTPS_REQUIRED');
  url.pathname = path;
  if (websocket) url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
