import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRelay } from '../apps/relay/dist/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

// One loopback listener for the built phone UI and the real relay. Never serves
// repository files, test fixtures, DSH's desktop server, or its management API.
export async function createTestEntry({ origin, invite, database }) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) {
    throw new Error('MOBILE_TEST_ORIGIN must be an HTTPS origin without a trailing slash');
  }
  if (typeof invite !== 'string' || invite.length < 32 || invite.length > 200) {
    throw new Error('RELAY_INVITE must contain 32 to 200 characters');
  }
  // Read only known build assets at startup; no request-controlled filesystem paths.
  const dist = join(root, 'apps/mobile/dist');
  const files = new Map();
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await collect(join(directory, entry.name), relative + '/');
      else if (entry.isFile() && contentTypes[extname(entry.name)]) {
        files.set('/' + relative, await readFile(join(directory, entry.name)));
      }
    }
  }
  await collect(dist);
  if (!files.has('/index.html')) throw new Error('Run pnpm build first');
  files.set('/', files.get('/index.html'));
  const { app } = createRelay({
    database, invite, inviteUses: 3, maxHosts: 3, maxConnections: 24,
    maxPeersPerHost: 4, maxBufferedBytes: 1048576, allowedOrigins: [origin],
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (request.routeOptions.url === '/metrics') return reply.code(404).send();
  });
  for (const [path, data] of files) {
    app.get(path, (_request, reply) => reply.type(contentTypes[extname(path)] ?? contentTypes['.html']).send(data));
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.MOBILE_TEST_ORIGIN;
  if (!origin) throw new Error('Set MOBILE_TEST_ORIGIN to the temporary HTTPS origin first');
  const app = await createTestEntry({
    origin, invite: process.env.RELAY_INVITE,
    database: join(root, 'data/test-entry/relay.sqlite'),
  });
  await app.listen({ host: '127.0.0.1', port: 4180 });
  console.log('Temporary test entry listening at http://127.0.0.1:4180');
  console.log('Set both plugin relayUrl and mobileUrl to MOBILE_TEST_ORIGIN.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close(); });
}
