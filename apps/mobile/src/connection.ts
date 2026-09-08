import { endpoint, messageSchema, parseJson, PhoneHandshake, type Pairing, type SecureStream, type WireMessage } from '@dsh-mobile/protocol';
import type { SavedHost } from './storage.js';
export type ConnectionState = 'connecting' | 'confirming' | 'connected' | 'offline' | 'denied' | 'stopped';
export class MobileConnection {
  private socket: WebSocket | undefined; private stream: SecureStream | undefined;
  private handshake: PhoneHandshake | undefined; private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined; private tries = 0;
  private pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  onState: (state: ConnectionState) => void = () => {};
  onEvent: (event: Extract<WireMessage, { type: 'event' }>) => void = () => {};
  onPaired: () => Promise<void> = async () => {};
  private wake = () => { if (!this.stopped && (!this.socket || this.socket.readyState === WebSocket.CLOSED)) { clearTimeout(this.timer); this.connect(); } };
  private sleep = () => { this.socket?.close(); this.onState('offline'); };
  private visible = () => { if (document.visibilityState === 'visible') this.wake(); };
  constructor(readonly host: SavedHost, private pair?: Pairing) {}
  start(): void {
    window.addEventListener('online', this.wake); window.addEventListener('offline', this.sleep);
    document.addEventListener('visibilitychange', this.visible); this.connect();
  }
  private connect(): void {
    if (this.stopped) return;
    if (!navigator.onLine) { this.onState('offline'); return; }
    this.stream = undefined; this.handshake = undefined; this.onState('connecting');
    const socket = this.socket = new WebSocket(endpoint(this.host.relayUrl, '/v1/socket', true));
    let chain = Promise.resolve();
    const deadline = setTimeout(() => socket.close(), this.pair ? Math.max(1000, this.pair.expiresAt - Date.now()) : 15000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', role: 'phone', hostId: this.host.hostId, publicKey: this.host.identity.publicKey }));
    socket.onmessage = event => {
      chain = chain.then(async () => {
        const packet = parseJson(String(event.data)) as { type: string; peerId?: string; payload?: unknown };
        if (packet.type === 'ready' && packet.peerId) { this.handshake = new PhoneHandshake(this.host.identity, this.host.hostKey, packet.peerId); return; }
        if (packet.type !== 'data' || !this.handshake) throw new Error('INVALID_FRAME');
        if (!this.stream) {
          if ((packet.payload as { type: string }).type !== 'box') throw new Error('INVALID_FRAME');
          if (!this.offered) {
            this.offered = true;
            this.raw(this.handshake.acceptOffer(packet.payload, this.host.name, this.pair?.token)); this.onState('confirming');
          } else {
            this.stream = this.handshake.acceptReady(packet.payload);
            this.pair = undefined; await this.onPaired(); clearTimeout(deadline); this.tries = 0; this.onState('connected');
          }
          return;
        }
        const message = messageSchema.parse(this.stream.decrypt(packet.payload)) as WireMessage;
        if (message.type === 'event') { this.onEvent(message); return; }
        const pending = this.pending.get(message.requestId); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.requestId);
        if (message.ok) pending.resolve(message.data); else pending.reject(new Error(message.error.code));
      }).catch(() => socket.close(1008, 'INVALID_FRAME'));
    };
    socket.onclose = event => {
      clearTimeout(deadline); this.offered = false; this.stream = undefined;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('RESULT_UNCERTAIN')); } this.pending.clear();
      if (this.stopped) return;
      if (event.code === 4003 || event.code === 1008) { this.onState('denied'); return; }
      this.onState('offline');
      this.timer = setTimeout(() => this.connect(), Math.min(30000, 500 * 2 ** Math.min(this.tries++, 6)) + Math.random() * 300);
    };
    socket.onerror = () => {};
  }
  private offered = false;
  private raw(payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 1048576) throw new Error('CONNECTION_UNAVAILABLE');
    this.socket.send(JSON.stringify({ type: 'send', payload }));
  }
  call<T = unknown>(method: string, args: Record<string, unknown> = {}, requestId: string = crypto.randomUUID()): Promise<T> {
    if (!this.stream) return Promise.reject(new Error('CONNECTION_UNAVAILABLE'));
    if (this.pending.has(requestId)) return Promise.reject(new Error('REQUEST_ALREADY_PENDING'));
    if (this.pending.size >= 32) return Promise.reject(new Error('TOO_MANY_REQUESTS'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('RESULT_UNCERTAIN')); }, 20000);
      this.pending.set(requestId, { resolve: data => resolve(data as T), reject, timer });
      try { this.raw(this.stream!.encrypt({ v: 1, requestId, method, ...args })); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  stop(): void {
    this.stopped = true; clearTimeout(this.timer); this.socket?.close(); this.onState('stopped');
    window.removeEventListener('online', this.wake); window.removeEventListener('offline', this.sleep); document.removeEventListener('visibilitychange', this.visible);
  }
}
