import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmRoot = process.env.DSH_PACKAGE_ROOT ?? join(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim(), '@deepseek-ai', 'dsh');
const launcher = join(npmRoot, 'lib', 'bin.js');
const version = JSON.parse(await readFile(join(npmRoot, 'package.json'), 'utf8')).version;
if (version !== '0.1.2-rc.1') throw new Error('Install @deepseek-ai/dsh@0.1.2-rc.1 for this integration test.');
const home = await mkdtemp(join(tmpdir(), 'dsh-mobile-integration-'));
const port = await new Promise<number>(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
const patch = join(home, 'test.patch.yml');
let pluginEntry: string | undefined;
if (process.env.MOBILE_TEST_PACKAGED === '1') {
 const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
 const archive = join(root, 'artifacts', 'dsh-mobile-host-' + version + '.tgz');
 const installOptions = { cwd: home, env: { ...process.env, DSH_HOME: home }, windowsHide: true, timeout: 60000 };
 execFileSync(process.execPath, [launcher, 'plugin', '--profile', 'web', 'add', archive, '--offline'], installOptions);
 const profilePath = join(home, 'profiles', 'web', 'package.json');
 const profile = JSON.parse(await readFile(profilePath, 'utf8'));
 if (!profile.dsh?.profile?.bundles?.includes('@dsh-mobile/host')) throw new Error('Plugin did not register as a DSH bundle');
 execFileSync(process.execPath, [launcher, 'plugin', '--profile', 'web', 'remove', '@dsh-mobile/host'], installOptions);
 if (JSON.parse(await readFile(profilePath, 'utf8')).dsh?.profile?.bundles?.includes('@dsh-mobile/host')) throw new Error('Plugin bundle was not removed');
 execFileSync('tar', ['-xzf', archive, '-C', home], { windowsHide: true });
 pluginEntry = join(home, 'package', 'index.mjs');
}
await writeFile(patch, '- insert:\n    - id: mobile-test\n      name: ' + JSON.stringify(pathToFileURL(resolve(root, 'tests/dsh-fixture.mjs')).href) + '\n');
const child = spawn(process.execPath, [launcher, '--profile', 'web', '--patch', patch, '--no-open', '--port', String(port)], {
  cwd: home, env: { ...process.env, DSH_HOME: home, DSH_TEST_LAUNCHER: launcher, DSH_TEST_ROOT: root, DSH_TEST_PORT: String(port), ...(pluginEntry ? { DSH_TEST_PLUGIN: pluginEntry } : {}) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
try {
  const deadline = Date.now() + 60000;
  let result: { ok: boolean; checks?: string[]; error?: string } | undefined;
  while (Date.now() < deadline && !result) {
    try { result = JSON.parse(await readFile(join(home, 'result.json'), 'utf8')); } catch {}
    if (!result) await new Promise(r => setTimeout(r, 200));
    if (child.exitCode !== null && !result) throw new Error('Isolated DSH exited before test result');
  }
  if (!result) throw new Error('Isolated DSH integration timed out');
  if (!result.ok) throw new Error(result.error);
  console.log('DSH ' + version + ' isolated integration passed: ' + result.checks?.join(', '));
} catch (error) {
  // DSH startup prints its browser token: never forward raw child output to CI.
  await writeFile(join(home, 'private-diagnostic.log'), output, { mode: 0o600 });
  console.error('Private diagnostic retained in isolated test home: ' + home);
  throw error;
} finally {
  child.kill();
  await new Promise<void>(r => { if (child.exitCode !== null) r(); else { child.once('exit', () => r()); setTimeout(r, 5000).unref(); } });
  // Retain failed diagnostics, remove only the exact mkdtemp directory after success.
  try { if (JSON.parse(await readFile(join(home, 'result.json'), 'utf8')).ok) await rm(home, { recursive: true, force: true }); } catch {}
}
