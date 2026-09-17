import test from 'node:test';
import assert from 'node:assert/strict';
import { startAdmin } from '../src/admin.mjs';

test('admin serves local no-store status and QR without token in health', async () => {
  const pairingCode = 'test_pairing_code';
  const admin = await startAdmin({ port: 0, publicOrigin: 'https://dsh.example.com', issuePublicUrl: () => `https://dsh.example.com/?pair=${pairingCode}`, version: '0.1.5-rc.1' });
  try {
    const page = await fetch(admin.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const pageBody = await page.text();
    assert.match(pageBody, new RegExp(pairingCode));
    assert.match(pageBody, /只能使用一次/);
    const health = await fetch(new URL('/health', admin.url));
    const body = await health.text();
    assert.equal(health.status, 200);
    assert.doesNotMatch(body, new RegExp(pairingCode));
    assert.deepEqual(JSON.parse(body), { status: 'ok', dshVersion: '0.1.5-rc.1', publicOrigin: 'https://dsh.example.com' });
  } finally { await admin.close(); }
});
