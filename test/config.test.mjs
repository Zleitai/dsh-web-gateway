import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePublicOrigin, parseArgs } from '../src/config.mjs';

test('public origin is strict HTTPS origin', () => {
  assert.equal(normalizePublicOrigin('https://dsh.example.com'), 'https://dsh.example.com');
  for (const value of ['http://dsh.example.com', 'https://dsh.example.com/path', 'https://user@dsh.example.com', 'not a url']) {
    assert.throws(() => normalizePublicOrigin(value));
  }
});

test('configuration validates paths and ports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-gateway-config-'));
  const launcher = join(directory, 'bin.js');
  writeFileSync(launcher, '');
  try {
    const config = parseArgs(['--public-origin', 'https://dsh.example.com', '--workspace', directory, '--dsh-launcher', launcher, '--port', '0', '--dsh-port', '3092', '--admin-port', '3210'], {});
    assert.equal(config.authority, 'dsh.example.com');
    assert.equal(config.port, 0);
    assert.equal(config.dshPort, 3092);
    assert.equal(config.adminPort, 3210);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
