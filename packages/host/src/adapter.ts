export interface WorkspaceView { id: string; title: string; path: string; sessionIds: readonly string[] }
export interface HistoryRecord { seq: number; endSeq: number; time: number; type: string; text: string; requestId?: string; queuedRequestIds?: string[]; status?: 'running' | 'completed' | 'failed' | 'cancelled' }
export interface HistoryPage { records: HistoryRecord[]; hasMore: boolean; cursor?: number; snapshot?: boolean }
export interface SessionView { sessionId: string; title: string; running: boolean }
export interface HarnessAdapter {
  workspaces(): WorkspaceView[];
  sessions(workspace: WorkspaceView, signal: AbortSignal): Promise<SessionView[]>;
  create(workspace: WorkspaceView, requestId: string): Promise<{ sessionId: string }>;
  send(sessionId: string, text: string, requestId: string): Promise<unknown>;
  cancel(sessionId: string): Promise<unknown> | unknown;
  page(sessionId: string, throughSeq: number, beforeSeq: number | undefined, signal: AbortSignal): Promise<HistoryPage>;
  follow(sessionId: string, signal: AbortSignal): AsyncIterable<HistoryPage>;
  reconcile(sessionId: string, requestId: string): Promise<boolean>;
}
/** Structural subset of the pinned published Host services; excludes arbitrary RPC. */
export interface HarnessServices {
  sessions: { get(sessionId: string): unknown; flush(session: unknown): Promise<void> };
  workspaceRegistry: { list(): WorkspaceView[] };
  sessionController: {
    list(request: object, signal: AbortSignal): Promise<{ items: { sessionId: string; running: boolean; projections?: unknown }[] }>;
    create(request: { workspaceId: string; sessionId: string }): Promise<{ sessionId: string }>;
    prompt(request: { sessionId: string; requestId: string; mode: 'queue'; content: { type: 'text'; text: string }[] }, signal: AbortSignal): Promise<unknown>;
    cancel(request: { sessionId: string }): unknown;
    page(request: { address: { kind: 'session'; sessionId: string }; throughSeq: number; beforeSeq?: number; maxMessages: number }, signal: AbortSignal): Promise<{ records: RawRecord[]; hasMore: boolean }>;
    follow(request: { address: { kind: 'session'; sessionId: string }; maxMessages: number }, signal: AbortSignal): AsyncIterable<RawFrame>;
  };
}
interface RawRecord { type: string; event: { seq: number; time: number; type: string; data: unknown } }
interface RawFrame { type: string; records?: RawRecord[]; cursor?: number; hasMore?: boolean; event?: RawRecord['event'] }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('');
  const data = object(value);
  if (data.type !== undefined && data.type !== 'text') return '';
  for (const field of ['text', 'texts', 'content', 'delta', 'message']) if (data[field] !== undefined) return textOf(data[field]);
  return '';
}
export function projectRecord(record: RawRecord): HistoryRecord {
  const e = record.event; const data = object(e.data);
  const source = object(data.source);
  const length = record.type === 'chunks' ? (Array.isArray(data.texts) ? data.texts.length : Array.isArray(data.args) ? data.args.length : 1) : 1;
  // Hide internal audit payloads, reasoning, and tool argument chunks. Keep their cursors.
  const visible = ['user/message', 'assistant/message', 'assistant/chunk', 'chunkrow/text-chunks'].includes(e.type);
  let text = visible ? textOf(data) : '';
  if (e.type === 'assistant/chunk') {
    const chunk = object(data.chunk);
    text = chunk.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : '';
  }
  const reason = object(data.reason).kind;
  const queuedRequestIds = e.type === 'agent/inbox/spliced' && Array.isArray(data.inserted) ? data.inserted.flatMap(message => { const id = object(object(message).source).rpcId; return typeof id === 'string' ? [id] : []; }) : [];
  const status = e.type === 'turn/start' ? 'running' : e.type === 'turn/end' ? reason === 'completed' ? 'completed' : reason === 'aborted' ? 'cancelled' : 'failed' : undefined;
  return { seq: e.seq, endSeq: e.seq + length - 1, time: e.time, type: e.type, text, ...(status ? { status } : {}), ...(queuedRequestIds.length ? { queuedRequestIds } : {}), ...(typeof source.rpcId === 'string' ? { requestId: source.rpcId } : {}) };
}
/** Keep a contiguous suffix; callers can page backwards for the omitted prefix. */
function boundedPage(page: HistoryPage): HistoryPage {
  let records = page.records; let hasMore = page.hasMore;
  while (Buffer.byteLength(JSON.stringify(records)) > 240000 && records.length > 1) { records = records.slice(Math.max(1, Math.floor(records.length / 2))); hasMore = true; }
  if (Buffer.byteLength(JSON.stringify(records)) > 240000) throw new Error('HISTORY_RECORD_TOO_LARGE');
  return { ...page, records, hasMore };
}
export class DshAdapter implements HarnessAdapter {
  constructor(private services: HarnessServices) {}
  workspaces(): WorkspaceView[] { return this.services.workspaceRegistry.list(); }
  async sessions(workspace: WorkspaceView, signal: AbortSignal): Promise<SessionView[]> {
    const list = await this.services.sessionController.list({}, signal);
    return list.items.filter(s => workspace.sessionIds.includes(s.sessionId)).map(s => {
      const title = object(object(s.projections).values).title;
      return { sessionId: s.sessionId, title: typeof title === 'string' ? title.slice(0, 500) : s.sessionId.slice(0, 16), running: s.running };
    });
  }
  async create(workspace: WorkspaceView, requestId: string) {
    const result = await this.services.sessionController.create({ workspaceId: workspace.id, sessionId: requestId });
    await this.checkpoint(result.sessionId); return { sessionId: result.sessionId };
  }
  async send(sessionId: string, text: string, requestId: string) {
    await this.services.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal);
    await this.checkpoint(sessionId); return { accepted: true };
  }
  private async checkpoint(sessionId: string) {
    const session = this.services.sessions.get(sessionId);
    if (!session) throw new Error('RESULT_UNCERTAIN');
    // Use the official persistence boundary before acknowledging a mutation.
    await this.services.sessions.flush(session);
  }
  cancel(sessionId: string) { return this.services.sessionController.cancel({ sessionId }); }
  async page(sessionId: string, throughSeq: number, beforeSeq: number | undefined, signal: AbortSignal): Promise<HistoryPage> {
    const page = await this.services.sessionController.page({ address: { kind: 'session', sessionId }, throughSeq, ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages: 10 }, signal);
    return boundedPage({ records: page.records.map(projectRecord), hasMore: page.hasMore });
  }
  async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<HistoryPage> {
    for await (const frame of this.services.sessionController.follow({ address: { kind: 'session', sessionId }, maxMessages: 10 }, signal)) {
      if (frame.type === 'snapshot') yield boundedPage({ snapshot: true, cursor: frame.cursor, records: (frame.records ?? []).map(projectRecord), hasMore: frame.hasMore ?? false });
      else if (frame.event) yield { records: [projectRecord({ type: 'event', event: frame.event })], hasMore: false };
    }
  }
  async reconcile(sessionId: string, requestId: string): Promise<boolean> {
    const controller = new AbortController();
    try {
      for await (const frame of this.follow(sessionId, controller.signal)) {
        controller.abort();
        if (frame.records.some(r => r.requestId === requestId || r.queuedRequestIds?.includes(requestId))) return true;
        let before = frame.records[0]?.seq; let more = frame.hasMore;
        // Bounded reconciliation: absence is inconclusive, never permission to re-submit.
        for (let i = 0; more && before !== undefined && i < 10; i++) {
          const page = await this.page(sessionId, frame.cursor ?? 0, before, new AbortController().signal);
          if (page.records.some(r => r.requestId === requestId || r.queuedRequestIds?.includes(requestId))) return true;
          const next = page.records[0]?.seq; if (next === undefined || next >= before) break;
          before = next; more = page.hasMore;
        }
        return false;
      }
      return false;
    } finally { controller.abort(); }
  }
}
