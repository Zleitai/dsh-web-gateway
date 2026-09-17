import test from 'node:test';
import assert from 'node:assert/strict';
import { startAdmin } from '../src/admin.mjs';

test('admin serves local no-store status and QR without token in health', async () => {
  const token = 'test_secret_token';
  const admin = await startAdmin({ port: 0, publicUrl: `https://dsh.example.com/#token=${token}`, version: '0.1.5-rc.1' });
  try {
    const page = await fetch(admin.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), new RegExp(token));
    const health = await fetch(new URL('/health', admin.url));
    const body = await health.text();
    assert.equal(health.status, 200);
    assert.doesNotMatch(body, new RegExp(token));
    assert.deepEqual(JSON.parse(body), { status: 'ok', dshVersion: '0.1.5-rc.1', publicOrigin: 'https://dsh.example.com' });
  } finally { await admin.close(); }
});
