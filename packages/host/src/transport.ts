import { WebSocket } from 'ws';
import { endpoint, HostHandshake, MAX_FRAME_BYTES, parseJson, requestSchema, type SecureStream, type WireMessage } from '@dsh-mobile/protocol';
import { HostController } from './controller.js';

interface Peer { key: string; handshake: HostHandshake; stream?: SecureStream; lifetime: AbortController; watches: Map<string, AbortController>; queue: Promise<void>; queued: number; accepting: boolean; deadline: ReturnType<typeof setTimeout> }
export class HostTransport {
  private socket: WebSocket | undefined; private peers = new Map<string, Peer>();
  private stopped = true; private retry: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  state: 'stopped' | 'connecting' | 'connected' | 'disconnected' = 'stopped';
  constructor(readonly controller: HostController, private relayUrl: string, private registration: { hostId: string; token: string }) {
    endpoint(relayUrl, '/');
    controller.onRevoke = key => { for (const [id, peer] of this.peers) if (peer.key === key) this.disconnect(id); };
    controller.onSharingChange = () => { for (const id of this.peers.keys()) this.disconnect(id); };
    controller.interactions.onChange = sessionId => {
      for (const [id, p] of this.peers) if (p.stream && p.watches.has(sessionId)) this.send(id, { v: 1, type: 'event', topic: 'interactions', sessionId, data: controller.interactions.list(sessionId) });
    };
  }
  hasPhone(): boolean { return [...this.peers.values()].some(p => p.stream && this.controller.device(p.key)); }
  start(): void { this.stopped = false; this.connect(); }
  private connect(): void {
    if (this.stopped) return;
    this.state = 'connecting';
    const socket = this.socket = new WebSocket(endpoint(this.relayUrl, '/v1/socket', true), { maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
    socket.on('open', () => this.raw({ type: 'hello', role: 'host', hostId: this.registration.hostId, token: this.registration.token }));
    socket.on('error', () => { /* close owns reconnect; never log handshake data */ });
    socket.on('message', raw => {
      let faultPeer: string | undefined;
      try {
        const message = parseJson(raw.toString()) as { type: string; peerId?: string; publicKey?: string; payload?: unknown };
        if (message.type === 'ready') { this.state = 'connected'; this.attempts = 0; return; }
        const id = message.peerId; if (!id) throw new Error('INVALID_PEER');
        faultPeer = id;
        if (message.type === 'peer') {
          if (this.peers.size >= 8 || !message.publicKey) { this.raw({ type: 'disconnect', peerId: id }); return; }
          const handshake = new HostHandshake(this.controller.store.identity(), message.publicKey, id);
          const peer: Peer = { key: message.publicKey, handshake, lifetime: new AbortController(), watches: new Map(), queue: Promise.resolve(), queued: 0, accepting: false, deadline: setTimeout(() => this.disconnect(id), 305000) };
          this.peers.set(id, peer); this.raw({ type: 'send', peerId: id, payload: handshake.offer() }); return;
        }
        if (message.type === 'gone') { this.cleanup(id); return; }
        const peer = this.peers.get(id); if (!peer || message.type !== 'data') return;
        // Serialize protocol state transitions. Pairing waits for local confirmation.
        if (!peer.stream) {
          if (peer.accepting) { this.disconnect(id); return; } peer.accepting = true;
          void peer.handshake.accept(message.payload, auth => this.controller.authorize(peer.key, auth.name, auth.token)).then(result => {
            if (peer.lifetime.signal.aborted || !this.controller.device(peer.key)) return;
            clearTimeout(peer.deadline); peer.stream = result.stream;
            this.raw({ type: 'send', peerId: id, payload: result.reply });
          }).catch(() => this.disconnect(id));
        } else {
          if (++peer.queued > 32) { this.disconnect(id); return; }
          const input = peer.stream.decrypt(message.payload);
          const request = requestSchema.parse(input);
          peer.queue = peer.queue.then(async () => {
            if (peer.lifetime.signal.aborted) return;
            const reply = await this.controller.execute(peer.key, request, peer.lifetime.signal);
            this.send(id, reply);
            if (reply.ok && request.method === 'sessions.watch') this.watch(id, request.sessionId);
            if (reply.ok && request.method === 'sessions.unwatch') { peer.watches.get(request.sessionId)?.abort(); peer.watches.delete(request.sessionId); }
          }).catch(() => this.disconnect(id)).finally(() => { peer.queued--; });
        }
      } catch { if (faultPeer && this.peers.has(faultPeer)) this.disconnect(faultPeer); else socket.close(1008, 'INVALID_FRAME'); }
    });
    socket.on('close', () => {
      for (const id of this.peers.keys()) this.cleanup(id);
      this.state = this.stopped ? 'stopped' : 'disconnected';
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), Math.min(30000, 500 * 2 ** Math.min(this.attempts++, 6)) + Math.random() * 300);
    });
  }
  private watch(id: string, sessionId: string): void {
    const peer = this.peers.get(id); if (!peer) return;
    for (const watch of peer.watches.values()) watch.abort();
    peer.watches.clear();
    const abort = new AbortController(); peer.watches.set(sessionId, abort);
    this.send(id, { v: 1, type: 'event', topic: 'interactions', sessionId, data: this.controller.interactions.list(sessionId) });
    void (async () => {
      try {
        for await (const frame of this.controller.adapter.follow(sessionId, abort.signal)) {
          this.controller.sessionWorkspace(sessionId);
          if (abort.signal.aborted) break;
          this.send(id, { v: 1, type: 'event', topic: 'history', sessionId, data: frame });
        }
      } catch {
        if (!abort.signal.aborted) this.send(id, { v: 1, type: 'event', topic: 'control', sessionId, data: { error: 'HISTORY_RESYNC_REQUIRED' } });
      }
    })();
  }
  private raw(value: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_FRAME_BYTES || this.socket.bufferedAmount > 1048576) { this.socket.close(1008, 'BACKPRESSURE'); return; }
    this.socket.send(text);
  }
  private send(id: string, message: WireMessage): void {
    const peer = this.peers.get(id);
    if (!peer?.stream || !this.controller.device(peer.key)) return;
    try { this.raw({ type: 'send', peerId: id, payload: peer.stream.encrypt(message) }); }
    catch {
      const fallback: WireMessage = message.type === 'response'
        ? { v: 1, type: 'response', requestId: message.requestId, ok: false, error: { code: 'RESULT_TOO_LARGE', message: 'RESULT_TOO_LARGE' } }
        : { v: 1, type: 'event', sessionId: message.sessionId, topic: 'control', data: { error: 'RESULT_TOO_LARGE' } };
      try { this.raw({ type: 'send', peerId: id, payload: peer.stream.encrypt(fallback) }); } catch { this.disconnect(id); }
    }
  }
  private cleanup(id: string): void {
    const peer = this.peers.get(id); if (!peer) return;
    peer.lifetime.abort(); clearTimeout(peer.deadline); for (const watch of peer.watches.values()) watch.abort();
    this.controller.dropPending(peer.key); this.peers.delete(id);
  }
  private disconnect(id: string): void { this.raw({ type: 'disconnect', peerId: id }); this.cleanup(id); }
  async stop(): Promise<void> {
    this.stopped = true; clearTimeout(this.retry);
    for (const id of this.peers.keys()) this.cleanup(id);
    this.state = 'stopped';
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      const socket = this.socket;
      await new Promise<void>(resolve => { socket.once('close', resolve); socket.terminate(); });
    }
  }
}
