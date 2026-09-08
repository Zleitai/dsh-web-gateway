import { createHash, randomUUID } from 'node:crypto';
import { equalSecret, fingerprint, pairingSchema, requestSchema, secret, type Pairing, type Reply, type RpcRequest } from '@dsh-mobile/protocol';
import type { HarnessAdapter, WorkspaceView } from './adapter.js';
import { HostStore, type Device } from './store.js';
import { Interactions } from './interactions.js';

export class HostController {
  readonly interactions = new Interactions();
  private pairing: { value: Pairing; claimed?: string } | undefined;
  private approvals = new Map<string, { name: string; publicKey: string; expiresAt: number; resolve: (allowed: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private inFlight = new Map<string, { digest: string; operation: Promise<Reply> }>();
  onRevoke: (key: string) => void = () => {};
  onSharingChange: () => void = () => {};
  constructor(readonly store: HostStore, readonly adapter: HarnessAdapter) {}
  shared(): WorkspaceView[] {
    const ids = this.store.get<string[]>('shared') ?? [];
    return this.adapter.workspaces().filter(w => ids.includes(w.id));
  }
  share(ids: string[]): void {
    const available = new Set(this.adapter.workspaces().map(w => w.id));
    if (ids.some(id => !available.has(id))) throw new Error('WORKSPACE_NOT_FOUND');
    this.store.set('shared', [...new Set(ids)]); this.onSharingChange();
  }
  sessionWorkspace(sessionId: string): WorkspaceView {
    const workspace = this.shared().find(w => w.sessionIds.includes(sessionId));
    if (!workspace) throw new Error('WORKSPACE_NOT_SHARED'); return workspace;
  }
  device(key: string): Device | undefined { return this.store.devices().find(d => d.publicKey === key); }
  revoke(id: string): void {
    const device = this.store.devices().find(d => d.id === id);
    if (device) { this.store.revoke(id); this.onRevoke(device.publicKey); }
  }
  pair(hostId: string, relayUrl: string): Pairing {
    this.cancelPairing();
    const value = pairingSchema.parse({ v: 1, hostId, relayUrl, hostKey: this.store.identity().publicKey, token: secret(), expiresAt: Date.now() + 300000 });
    this.pairing = { value }; return value;
  }
  pending() { return [...this.approvals.entries()].map(([id, p]) => ({ id, name: p.name, expiresAt: p.expiresAt, fingerprint: fingerprint(this.store.identity().publicKey, p.publicKey) })); }
  confirm(id: string, allowed: boolean): void {
    const pending = this.approvals.get(id);
    if (!pending || pending.expiresAt <= Date.now()) throw new Error('PAIRING_EXPIRED');
    this.approvals.delete(id); clearTimeout(pending.timer);
    if (allowed && !this.device(pending.publicKey)) this.store.addDevice({ id: randomUUID(), publicKey: pending.publicKey, name: pending.name, createdAt: Date.now() });
    this.pairing = undefined; pending.resolve(allowed);
  }
  authorize(key: string, name: string, token?: string): Promise<boolean> {
    if (this.device(key)) return Promise.resolve(true);
    const pair = this.pairing;
    if (!pair || pair.value.expiresAt <= Date.now() || !token || !equalSecret(pair.value.token, token) || (pair.claimed && pair.claimed !== key)) return Promise.resolve(false);
    pair.claimed = key;
    // Reconnect replaces only this phone's pending transport; it never creates duplicate approvals.
    this.dropPending(key);
    return new Promise(resolve => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.approvals.delete(id); resolve(false); }, Math.max(1, pair.value.expiresAt - Date.now()));
      this.approvals.set(id, { name, publicKey: key, expiresAt: pair.value.expiresAt, resolve, timer });
    });
  }
  dropPending(key: string): void {
    for (const [id, p] of this.approvals) if (p.publicKey === key) { clearTimeout(p.timer); p.resolve(false); this.approvals.delete(id); }
  }
  cancelPairing(): void {
    this.pairing = undefined;
    for (const p of this.approvals.values()) { clearTimeout(p.timer); p.resolve(false); }
    this.approvals.clear();
  }
  async execute(publicKey: string, input: unknown, signal: AbortSignal): Promise<Reply> {
    const request = requestSchema.parse(input);
    if (!this.device(publicKey)) return failure(request, 'DEVICE_NOT_AUTHORIZED');
    const receiptKey = publicKey + ':' + request.requestId;
    const existing = this.inFlight.get(receiptKey);
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const record = this.store.receipt(receiptKey);
    if (record && record.hash !== digest) return failure(request, 'REQUEST_ID_CONFLICT');
    if (existing) return existing.digest === digest ? existing.operation : failure(request, 'REQUEST_ID_CONFLICT');
    if ('workspaceId' in request && !this.shared().some(w => w.id === request.workspaceId)) return failure(request, 'WORKSPACE_NOT_SHARED');
    if ('sessionId' in request) {
      try { this.sessionWorkspace(request.sessionId); } catch { return failure(request, 'WORKSPACE_NOT_SHARED'); }
    }
    const mutating = ['sessions.send', 'sessions.create', 'sessions.cancel', 'interactions.answer'].includes(request.method);
    const perform = async (): Promise<Reply> => {
      try {
        if (mutating && record) {
          if (record.state === 'done') return JSON.parse(record.result!) as Reply;
          if (request.method === 'sessions.send' && await this.adapter.reconcile(request.sessionId, request.requestId)) {
            const reply = success(request, { accepted: true }); this.store.finish(receiptKey, reply); return reply;
          }
          if (request.method !== 'sessions.create') return failure(request, 'RESULT_UNCERTAIN');
          // DSH create explicitly adopts an existing client-minted session id.
        } else if (mutating) this.store.begin(receiptKey, digest);
        const data = await this.dispatch(request, signal);
        const reply = success(request, data);
        if (mutating) this.store.finish(receiptKey, reply);
        return reply;
      } catch (error) {
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'HARNESS_OPERATION_FAILED';
        // A thrown upstream mutation may have committed. Keep its receipt pending.
        return failure(request, code);
      }
    };
    const operation = perform(); this.inFlight.set(receiptKey, { digest, operation });
    try { return await operation; } finally { this.inFlight.delete(receiptKey); }
  }
  private async dispatch(r: RpcRequest, signal: AbortSignal): Promise<unknown> {
    const workspace = (id: string) => { const w = this.shared().find(w => w.id === id); if (!w) throw new Error('WORKSPACE_NOT_SHARED'); return w; };
    switch (r.method) {
      case 'workspaces.list': return this.shared().map(w => ({ id: w.id, title: w.title }));
      case 'sessions.list': return this.adapter.sessions(workspace(r.workspaceId), signal);
      case 'sessions.create': return this.adapter.create(workspace(r.workspaceId), r.requestId);
      case 'sessions.history': return this.adapter.page(r.sessionId, r.throughSeq, r.beforeSeq, signal);
      case 'sessions.send': return this.adapter.send(r.sessionId, r.text, r.requestId);
      case 'sessions.cancel': return this.adapter.cancel(r.sessionId);
      case 'interactions.list': return this.interactions.list(r.sessionId);
      case 'interactions.answer': this.interactions.answer(r.sessionId, r.interactionId, r.answer); return { accepted: true };
      case 'sessions.watch': case 'sessions.unwatch': return { accepted: true };
    }
  }
  close(): void { this.cancelPairing(); this.interactions.close(); }
}
function success(r: RpcRequest, data: unknown): Reply { return { v: 1, type: 'response', requestId: r.requestId, ok: true, data }; }
function failure(r: RpcRequest, code: string): Reply { return { v: 1, type: 'response', requestId: r.requestId, ok: false, error: { code, message: code } }; }
