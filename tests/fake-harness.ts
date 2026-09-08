import { randomUUID } from 'node:crypto';
import type { HarnessAdapter, HistoryPage, HistoryRecord, WorkspaceView } from '../packages/host/src/adapter.js';
export class FakeHarness implements HarnessAdapter {
  workspace: WorkspaceView = { id: randomUUID(), title: '示例工作区', path: '/fixture', sessionIds: [] };
  histories = new Map<string, HistoryRecord[]>(); running = new Set<string>(); sends = 0; cancels = 0;
  listeners = new Set<() => void>();
  onPrompt: (sessionId: string, text: string) => void = () => {};
  workspaces() { return [this.workspace]; }
  async sessions(w: WorkspaceView) { return w.sessionIds.map(sessionId => ({ sessionId, title: '任务 ' + sessionId.slice(0, 6), running: this.running.has(sessionId) })); }
  async create(w: WorkspaceView, id: string) { if (!this.histories.has(id)) { this.histories.set(id, []); w.sessionIds = [...w.sessionIds, id]; } return { sessionId: id }; }
  async send(sessionId: string, text: string, requestId: string) { this.sends++; this.append(sessionId, 'user/message', text, requestId); this.running.add(sessionId); this.onPrompt(sessionId, text); return { accepted: true }; }
  cancel(sessionId: string) { this.cancels++; this.running.delete(sessionId); return { accepted: true }; }
  append(sessionId: string, type: string, text: string, requestId?: string) { const rows = this.histories.get(sessionId)!; rows.push({ seq: rows.length, endSeq: rows.length, time: Date.now(), type, text, ...(requestId ? { requestId } : {}) }); for (const f of this.listeners) f(); }
  async page(sessionId: string, throughSeq: number, beforeSeq?: number): Promise<HistoryPage> { const all = this.histories.get(sessionId)!.filter(r => r.seq <= throughSeq && (beforeSeq === undefined || r.seq < beforeSeq)); return { records: all.slice(-10), hasMore: all.length > 10 }; }
  async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<HistoryPage> {
    let seen = this.histories.get(sessionId)!.length;
    const all = this.histories.get(sessionId)!;
    yield { snapshot: true, cursor: seen - 1, records: all.slice(-10), hasMore: all.length > 10 };
    while (!signal.aborted) {
      if (this.histories.get(sessionId)!.length === seen) await new Promise<void>(resolve => { const done = () => { this.listeners.delete(done); signal.removeEventListener('abort', done); resolve(); }; this.listeners.add(done); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done(); });
      const rows = this.histories.get(sessionId)!;
      if (rows.length > seen) { const records = rows.slice(seen); seen = rows.length; yield { records, hasMore: false }; }
    }
  }
  async reconcile(sessionId: string, requestId: string) { return this.histories.get(sessionId)!.some(r => r.requestId === requestId); }
}
