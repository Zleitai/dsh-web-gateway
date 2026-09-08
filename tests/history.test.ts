import { expect, test } from 'vitest';
import { recoverWindow } from '../apps/mobile/src/history.js';
test('reconnect backfills every missing sequence before installing a fresh snapshot', async () => {
 const rows = Array.from({ length: 45 }, (_, seq) => ({ seq, endSeq: seq }));
 const cuts: number[] = [];
 const recovered = await recoverWindow(rows.slice(0, 10), { records: rows.slice(40), hasMore: true, cursor: 44 }, async before => {
  cuts.push(before); return { records: rows.slice(Math.max(0, before - 10), before), hasMore: before > 10 };
 });
 expect(cuts).toEqual([40, 30, 20]); expect(recovered.records).toEqual(rows);
});
test('overlapping packed runs replace their older partial representation', async () => {
 const result = await recoverWindow([{ seq: 0, endSeq: 1 }, { seq: 2, endSeq: 4 }], { records: [{ seq: 2, endSeq: 8 }], hasMore: false }, async () => { throw Error(); });
 expect(result.records).toEqual([{ seq: 0, endSeq: 1 }, { seq: 2, endSeq: 8 }]);
});
