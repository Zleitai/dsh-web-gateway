import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const bootstrapLog = join(process.env.TEMP ?? process.cwd(), 'dsh-web-gateway-bootstrap.log');
process.once('uncaughtException', error => {
  appendFileSync(bootstrapLog, `[${new Date().toISOString()}] ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

const configPath = process.argv[2];
if (!configPath) throw new Error('Missing configuration path');

const config = JSON.parse(readFileSync(configPath, 'utf8'));
for (const property of ['nodePath', 'entrypoint', 'publicOrigin', 'workspace', 'logPath']) {
  if (!config[property]) throw new Error(`Missing '${property}' in ${configPath}`);
}
for (const path of [config.nodePath, config.entrypoint, config.workspace]) {
  if (!existsSync(path)) throw new Error(`Configured path was not found: ${path}`);
}

const logDirectory = dirname(config.logPath);
mkdirSync(logDirectory, { recursive: true });
if (existsSync(config.logPath) && statSync(config.logPath).size > 5 * 1024 * 1024) {
  const previousLog = join(logDirectory, 'gateway.previous.log');
  rmSync(previousLog, { force: true });
  renameSync(config.logPath, previousLog);
}
const log = openSync(config.logPath, 'a');
writeSync(log, `[${new Date().toISOString()}] Starting DSH Web Gateway\n`);

const argumentsList = [
  config.entrypoint,
  '--public-origin', config.publicOrigin,
  '--workspace', config.workspace,
];
if (config.dshLauncher) argumentsList.push('--dsh-launcher', config.dshLauncher);

const child = spawn(config.nodePath, argumentsList, {
  cwd: dirname(config.entrypoint),
  env: process.env,
  stdio: ['ignore', log, log],
  windowsHide: true,
});

let stopping = false;
child.once('error', error => {
  writeSync(log, `[${new Date().toISOString()}] Failed to start: ${error.message}\n`);
  closeSync(log);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  writeSync(log, `[${new Date().toISOString()}] Gateway stopped (${signal ?? code ?? 'unknown'})\n`);
  closeSync(log);
  process.exitCode = stopping && code === null ? 0 : (code ?? 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  });
}
