import { parseArgs } from './config.mjs';
import { startDsh } from './dsh.mjs';
import { startAdmin } from './admin.mjs';
import { publicPairingUrl, startGateway } from './gateway.mjs';

let dsh;
let admin;
let gateway;
let stopping = false;
try {
  const config = parseArgs(process.argv.slice(2));
  dsh = startDsh(config, { onLog: line => process.stderr.write(`[dsh] ${line}\n`) });
  const ready = await dsh.ready;
  gateway = await startGateway({ port: config.port, upstreamUrl: ready.localUrl, publicOrigin: config.publicOrigin });
  const publicUrl = publicPairingUrl(ready.localUrl, config.publicOrigin);
  admin = await startAdmin({ port: config.adminPort, publicUrl, version: ready.version });
  console.log(`DSH Web Gateway ready. Local management: ${admin.url}`);
  console.log(`Public origin: ${config.publicOrigin}`);
  console.log('The DSH process token is available only on the local management page.');
  void dsh.exited.then(async ({ code, signal }) => {
    if (stopping) return;
    console.error(`DSH stopped unexpectedly (${signal ?? code ?? 'unknown'}).`);
    await admin?.close();
    await gateway?.close();
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await gateway?.close();
  await dsh?.stop();
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    stopping = true;
    await admin?.close();
    await gateway?.close();
    await dsh?.stop();
  });
}
