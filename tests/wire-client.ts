import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { identity, PhoneHandshake, type Identity, type Pairing, type SecureStream } from '../packages/protocol/dist/index.js';
export class TestPhone {
 socket!: WebSocket; stream!: SecureStream; handshake!: PhoneHandshake;
 events: any[] = []; packets: any[] = []; key: Identity; private readyResolve!: () => void; private readyReject!: (e: Error) => void;
 private pending = new Map<string, (reply: any) => void>(); private offered = false;
 constructor(readonly pair: Pairing, key?: Identity) { this.key = key ?? identity(); }
 connect() {
  const ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; }); ready.catch(() => {});
  this.socket = new WebSocket(this.pair.relayUrl.replace('http', 'ws') + '/v1/socket');
  this.socket.on('open', () => this.socket.send(JSON.stringify({ type: 'hello', role: 'phone', hostId: this.pair.hostId, publicKey: this.key.publicKey })));
  this.socket.on('message', raw => {
   const message = JSON.parse(raw.toString()); this.packets.push(message);
   try {
    if (message.type === 'ready') { this.handshake = new PhoneHandshake(this.key, this.pair.hostKey, message.peerId); return; }
    if (!this.stream) {
     if (!this.offered) { this.offered = true; this.send(this.handshake.acceptOffer(message.payload, 'Test phone', this.pair.token)); }
     else { this.stream = this.handshake.acceptReady(message.payload); this.readyResolve(); }
    } else { const result = this.stream.decrypt(message.payload) as any; if (result.type === 'event') this.events.push(result); else { this.pending.get(result.requestId)?.(result); this.pending.delete(result.requestId); } }
   } catch (error) { this.readyReject(error as Error); }
  });
  this.socket.on('error', e => this.readyReject(e)); this.socket.on('close', () => this.readyReject(new Error('CONNECTION_CLOSED')));
  return ready;
 }
 send(payload: unknown) { this.socket.send(JSON.stringify({ type: 'send', payload })); }
 async call(method: string, args = {}, requestId = randomUUID()): Promise<any> {
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('RPC_TIMEOUT')); }, 5000);
   this.pending.set(requestId, reply => { clearTimeout(timer); resolve(reply); });
   this.send(this.stream.encrypt({ v: 1, requestId, method, ...args }));
  });
 }
 close() { this.socket?.terminate(); }
}
export async function until(predicate: () => boolean | Promise<boolean>, timeout = 10000) { const deadline = Date.now() + timeout; while (!await predicate()) { if (Date.now() > deadline) throw new Error('CONDITION_TIMEOUT'); await new Promise(r => setTimeout(r, 20)); } }
