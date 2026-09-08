import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve('.');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const staging = resolve('artifacts/plugin/package');
await mkdir(staging, { recursive: true });
const bundled = await build({
 entryPoints: ['packages/host/src/plugin.ts'], outfile: join(staging, 'index.mjs'),
 bundle: true, platform: 'node', format: 'esm', target: 'node24',
 external: ['bufferutil', 'utf-8-validate'],
 banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
 legalComments: 'external', sourcemap: false, minify: false, metafile: true,
});
const licenses = new Map();
for (const input of Object.keys(bundled.metafile.inputs)) {
 if (!input.includes('node_modules')) continue;
 let directory = dirname(resolve(input));
 while (directory.includes('node_modules')) {
  try {
   const meta = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
   if (meta.name) {
    const id = meta.name + '@' + meta.version;
    if (!licenses.has(id)) {
     const names = (await readdir(directory)).filter(n => /^(license|copying|notice)(\..*)?$/i.test(n));
     if (!names.length) throw new Error('Missing bundled license: ' + id);
     licenses.set(id, (await Promise.all(names.map(n => readFile(join(directory, n), 'utf8')))).join('\n'));
    }
    break;
   }
  } catch (e) { if (e.message?.startsWith('Missing bundled license:')) throw e; }
  directory = dirname(directory);
 }
}
await writeFile(join(staging, 'THIRD_PARTY_LICENSES.txt'), [...licenses].sort().map(([name, text]) => name + '\n' + text).join('\n\n'));
await writeFile(join(staging, 'package.json'), JSON.stringify({
 name: '@dsh-mobile/host', version, description: 'Pair a phone with an existing DeepSeek Harness session',
 type: 'module', main: './index.mjs', exports: { '.': './index.mjs', './package.json': './package.json', './cordis.patch.yml': './cordis.patch.yml' }, license: 'MIT', engines: { node: '>=24.0.0' },
 files: ['index.mjs', 'index.mjs.LEGAL.txt', 'cordis.patch.yml', 'LICENSE', 'THIRD_PARTY.md', 'THIRD_PARTY_LICENSES.txt'],
 dsh: { bundle: { patch: './cordis.patch.yml' } },
}, null, 2) + '\n');
for (const [from, to] of [['packages/host/cordis.patch.yml', 'cordis.patch.yml'], ['LICENSE', 'LICENSE'], ['docs/THIRD_PARTY.md', 'THIRD_PARTY.md']]) await copyFile(from, join(staging, to));
const plugin = resolve('artifacts/dsh-mobile-host-' + version + '.tgz');
execFileSync('tar', ['-czf', plugin, '-C', resolve('artifacts/plugin'), 'package'], { windowsHide: true });
const mobile = resolve('artifacts/dsh-mobile-web-' + version + '.tgz');
execFileSync('tar', ['-czf', mobile, '-C', resolve('apps/mobile/dist'), '.'], { windowsHide: true });
const checksums = await Promise.all([plugin, mobile].map(async path => createHash('sha256').update(await readFile(path)).digest('hex') + '  ' + path.slice(path.lastIndexOf(process.platform === 'win32' ? '\\' : '/') + 1)));
await writeFile('artifacts/SHA256SUMS', checksums.join('\n') + '\n');
console.log('Plugin and mobile archives built in ' + resolve('artifacts'));
