export interface Sequenced { seq: number; endSeq: number }
export interface Window<T> { records: T[]; hasMore: boolean; cursor?: number }
export async function recoverWindow<T extends Sequenced>(old: T[], snapshot: Window<T>, load: (before: number) => Promise<Window<T>>): Promise<Window<T>> {
 let records = snapshot.records; let more = snapshot.hasMore;
 const last = old.at(-1)?.endSeq;
 while (last !== undefined && more && records[0] && records[0].seq > last + 1) {
  const before = records[0].seq; const page = await load(before);
  if (!page.records.length || page.records[0]!.seq >= before) throw new Error('HISTORY_RESYNC_REQUIRED');
  records = [...page.records, ...records]; more = page.hasMore;
 }
 const start = records[0]?.seq;
 if (last !== undefined && start !== undefined && start > last + 1) throw new Error('HISTORY_RESYNC_REQUIRED');
 return { ...snapshot, records: start === undefined ? old : [...old.filter(r => r.endSeq < start), ...records], hasMore: old.length ? old[0]!.seq > 0 : more };
}
