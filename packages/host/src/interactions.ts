import { randomUUID } from 'node:crypto';
export interface Interaction {
  id: string; sessionId: string; kind: 'approval' | 'question'; toolName?: string; reason?: string;
  questions?: { id: string; question: string; detail?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] }[];
}
interface Pending { view: Interaction; resolve: (value: unknown) => void; reject: (error: Error) => void }
/** One authoritative pending decision, with desktop and phone racing for the same result. */
export class Interactions {
  private pending = new Map<string, Pending>();
  onChange: (sessionId: string) => void = () => {};
  list(sessionId: string): Interaction[] { return [...this.pending.values()].filter(p => p.view.sessionId === sessionId).map(p => p.view); }
  async ask(view: Omit<Interaction, 'id'>, signal: AbortSignal | undefined, desktop: () => Promise<unknown>, mobileAvailable = true): Promise<unknown> {
    if (signal?.aborted) throw new Error('INTERACTION_CANCELLED');
    const id = randomUUID();
    let rejectPending!: (error: Error) => void;
    const mobile = new Promise<unknown>((resolve, reject) => {
      rejectPending = reject; this.pending.set(id, { view: { ...view, id }, resolve, reject });
    });
    const onAbort = () => rejectPending(new Error('INTERACTION_CANCELLED'));
    signal?.addEventListener('abort', onAbort, { once: true });
    this.onChange(view.sessionId);
    // A missing desktop answerer must not win against a connected, authorized phone.
    const other = Promise.resolve().then(desktop)
      .catch(error => { if (mobileAvailable && view.kind === 'question' && error?.code === 'NO_PROVIDER') return undefined; throw error; })
      .then(value => mobileAvailable && (value === 'unavailable' || value === undefined) ? new Promise<never>(() => {}) : value);
    try { return await Promise.race([mobile, other]); }
    finally { this.pending.delete(id); signal?.removeEventListener('abort', onAbort); this.onChange(view.sessionId); }
  }
  answer(sessionId: string, id: string, value: unknown): void {
    const entry = this.pending.get(id);
    if (!entry || entry.view.sessionId !== sessionId) throw new Error('INTERACTION_EXPIRED');
    if (entry.view.kind === 'approval') {
      if (value !== 'allowed-once' && value !== 'rejected') throw new Error('INVALID_ANSWER');
    } else {
      const answers = (value as { answers?: { id: string; selected: string[]; custom?: string }[] }).answers;
      const questions = entry.view.questions ?? [];
      if (!answers || answers.length !== questions.length || new Set(answers.map(a => a.id)).size !== answers.length) throw new Error('INVALID_ANSWER');
      for (const q of questions) {
        const answer = answers.find(a => a.id === q.id);
        if (!answer || (!q.multiSelect && answer.selected.length > 1) || answer.selected.some(label => !q.options?.some(o => o.label === label)) || (!answer.selected.length && !answer.custom?.trim())) throw new Error('INVALID_ANSWER');
      }
    }
    this.pending.delete(id); entry.resolve(value); this.onChange(sessionId);
  }
  close(): void { for (const p of this.pending.values()) p.reject(new Error('INTERACTION_CANCELLED')); this.pending.clear(); }
}
