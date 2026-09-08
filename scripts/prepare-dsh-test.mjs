import { build } from 'esbuild';
await build({ entryPoints: ['tests/wire-client.ts'], outfile: 'tests/wire-client.mjs', platform: 'node', format: 'esm', target: 'node24' });
