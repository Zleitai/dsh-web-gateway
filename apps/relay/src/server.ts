import Fastify from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { envelopeSchema, MAX_FRAME_BYTES, parseJson, relayHelloSchema } from '@dsh-mobile/protocol';
import { z } from 'zod';

export interface RelayOptions {
  database: string; invite?: string; inviteUses?: number; maxHosts?: number; maxPeersPerHost?: number;
  allowedOrigins: string[]; maxConnections?: number; messagesPerMinute?: number; maxBufferedBytes?: number;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const registration = z.object({ invite: z.string().max(200).optional() }).strict();
const routed = z.object({ type: z.literal('send'), peerId: z.string().uuid().optional(), payload: envelopeSchema }).strict();
const disconnect = z.object({ type: z.literal('disconnect'), peerId: z.string().uuid() }).strict();

export function createRelay(options: RelayOptions) {
  if (options.database !== ':memory:') mkdirSync(dirname(options.database), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(options.database);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS hosts(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY, remaining INTEGER NOT NULL)');
  if (options.invite) db.prepare('INSERT OR IGNORE INTO invitations VALUES(?,?)').run(hash(options.invite), options.inviteUses ?? 20);
  const app = Fastify({ logger: false, bodyLimit: 4096, trustProxy: false });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  const hosts = new Map<string, WebSocket>();
  const peers = new Map<string, { hostId: string; socket: WebSocket }>();
  const limits = new Map<string, { until: number; count: number }>();
  const metrics = { connections: 0, accepted: 0, rejected: 0, frames: 0, bytes: 0, reconnects: 0, reconnectMillisTotal: 0, reconnectMillisMax: 0, closeCodes: {} as Record<string, number> };
  const disconnected = new Map<string, number>();
  function budget(key: string, max: number): boolean {
    const now = Date.now();
    const entry = limits.get(key);
    if (!entry || entry.until < now) { limits.set(key, { until: now + 60000, count: 1 }); return true; }
    return ++entry.count <= max;
  }
  const sweep = setInterval(() => {
    for (const [key, v] of limits) if (v.until < Date.now()) limits.delete(key);
    for (const [key, time] of disconnected) if (Date.now() - time > 300000) disconnected.delete(key);
  }, 60000);
  sweep.unref();
  function send(socket: WebSocket, value: unknown) {
    if (socket.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_FRAME_BYTES || socket.bufferedAmount + Buffer.byteLength(text) > (options.maxBufferedBytes ?? 2 * MAX_FRAME_BYTES)) { socket.close(1008, 'SLOW_CONNECTION'); return; }
    socket.send(text);
  }
  app.get('/health', () => ({ status: 'ok', hosts: hosts.size, peers: peers.size }));
  // This aggregate contains no device ids, IPs, keys, message bodies, or tokens.
  app.get('/metrics', () => ({ ...metrics, activeConnections: sockets.clients.size }));
  app.post('/v1/hosts', (req, reply) => {
    if (!budget('register:' + req.ip, 5)) return reply.code(429).send({ error: 'RATE_LIMIT' });
    const parsed = registration.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const count = db.prepare('SELECT COUNT(*) AS n FROM hosts').get() as { n: number };
    if (count.n >= (options.maxHosts ?? 100)) return reply.code(503).send({ error: 'CAPACITY' });
    db.exec('BEGIN IMMEDIATE');
    try {
      if (options.invite) {
        const result = db.prepare('UPDATE invitations SET remaining=remaining-1 WHERE hash=? AND remaining>0').run(hash(parsed.data.invite ?? ''));
        if (result.changes !== 1) { db.exec('ROLLBACK'); return reply.code(403).send({ error: 'INVITE_REQUIRED' }); }
      }
      const hostId = randomUUID(); const token = randomBytes(32).toString('base64');
      db.prepare('INSERT INTO hosts VALUES(?,?,?)').run(hostId, hash(token), Date.now());
      db.exec('COMMIT');
      reply.header('cache-control', 'no-store');
      return { hostId, token };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  app.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;
    if (url.pathname !== '/v1/socket' || url.search || (origin && !options.allowedOrigins.includes(origin)) ||
        sockets.clients.size >= (options.maxConnections ?? 500) || !budget('upgrade:' + req.socket.remoteAddress, 30)) {
      metrics.rejected++; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', socket => {
    metrics.connections++;
    let role: 'host' | 'phone' | undefined; let hostId = ''; let peerId = ''; let alive = true; let connectionKey = '';
    const deadline = setTimeout(() => socket.close(1008, 'HELLO_TIMEOUT'), 5000);
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) socket.terminate(); else { alive = false; socket.ping(); } }, 25000);
    socket.on('error', () => socket.terminate());
    socket.on('message', raw => {
      try {
        if (!budget('socket:' + (peerId || hostId || 'pending'), options.messagesPerMinute ?? 6000)) throw new Error('RATE_LIMIT');
        metrics.frames++; metrics.bytes += Buffer.byteLength(raw.toString());
        const input = parseJson(raw.toString());
        if (!role) {
          const hello = relayHelloSchema.parse(input); hostId = hello.hostId;
          if (hello.role === 'host') {
            const row = db.prepare('SELECT token_hash FROM hosts WHERE id=?').get(hostId) as { token_hash: string } | undefined;
            if (!row || hash(hello.token) !== row.token_hash) throw new Error('AUTH_FAILED');
            // Reject duplicate hosts instead of killing an existing host and all its phones.
            if (hosts.has(hostId)) throw new Error('HOST_ALREADY_CONNECTED');
            role = 'host'; hosts.set(hostId, socket); send(socket, { type: 'ready' });
          } else {
            const host = hosts.get(hostId);
            if (!host) { socket.close(4001, 'HOST_OFFLINE'); return; }
            if ([...peers.values()].filter(p => p.hostId === hostId).length >= (options.maxPeersPerHost ?? 8)) throw new Error('PEER_LIMIT');
            role = 'phone'; peerId = randomUUID(); peers.set(peerId, { hostId, socket });
            send(socket, { type: 'ready', peerId });
            send(host, { type: 'peer', peerId, publicKey: hello.publicKey });
          }
          connectionKey = hello.role === 'host' ? 'host:' + hostId : 'phone:' + hostId + ':' + hello.publicKey;
          metrics.accepted++;
          const since = disconnected.get(connectionKey);
          if (since !== undefined) { const elapsed = Date.now() - since; metrics.reconnects++; metrics.reconnectMillisTotal += elapsed; metrics.reconnectMillisMax = Math.max(metrics.reconnectMillisMax, elapsed); disconnected.delete(connectionKey); }
          clearTimeout(deadline); return;
        }
        const close = disconnect.safeParse(input);
        if (role === 'host' && close.success) {
          const peer = peers.get(close.data.peerId);
          if (peer?.hostId === hostId) peer.socket.close(4003, 'REVOKED_OR_DENIED');
          return;
        }
        const packet = routed.parse(input);
        if (role === 'host') {
          const peer = peers.get(packet.peerId ?? '');
          if (!peer) return; // A phone can close while its host reply is in transit.
          if (peer.hostId !== hostId) throw new Error('UNKNOWN_PEER');
          send(peer.socket, { type: 'data', payload: packet.payload });
        } else {
          if (packet.peerId) throw new Error('INVALID_TARGET');
          const host = hosts.get(hostId); if (!host) throw new Error('HOST_OFFLINE');
          send(host, { type: 'data', peerId, payload: packet.payload });
        }
      } catch { metrics.rejected++; socket.close(1008, 'PROTOCOL_OR_AUTH_ERROR'); }
    });
    socket.on('close', code => {
      const label = [1000, 1001, 1006, 1008, 1009, 4001, 4003].includes(code) ? String(code) : 'other';
      metrics.closeCodes[label] = (metrics.closeCodes[label] ?? 0) + 1;
      if (connectionKey && disconnected.size < 10000) disconnected.set(connectionKey, Date.now());
      clearTimeout(deadline); clearInterval(heartbeat);
      if (role === 'host' && hosts.get(hostId) === socket) {
        hosts.delete(hostId);
        for (const peer of peers.values()) if (peer.hostId === hostId) peer.socket.close(4001, 'HOST_OFFLINE');
      } else if (role === 'phone') {
        peers.delete(peerId); const host = hosts.get(hostId); if (host) send(host, { type: 'gone', peerId });
      }
    });
  });
  app.addHook('preClose', async () => {
    clearInterval(sweep); for (const socket of sockets.clients) socket.terminate();
  });
  app.addHook('onClose', async () => {
    await new Promise<void>(resolve => sockets.close(() => resolve())); db.close();
  });
  return { app, metrics };
}
