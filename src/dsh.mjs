import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const SUPPORTED_VERSION = '0.1.5-rc.1';
const READY_PREFIX = 'dsh web: ';

export function resolveDshLauncher(explicit) {
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    const launcher = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (existsSync(launcher)) return launcher;
  } else {
    const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    const launcher = join(npmRoot, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (existsSync(launcher)) return launcher;
  }
  throw new Error('Cannot locate DSH. Set --dsh-launcher to @deepseek-ai/dsh/lib/bin.js');
}

export function inspectDsh(launcher) {
  const packagePath = resolve(dirname(launcher), '..', 'package.json');
  const version = JSON.parse(readFileSync(packagePath, 'utf8')).version;
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`Unsupported DSH ${version}; this connector is verified with ${SUPPORTED_VERSION}`);
  }
  const result = spawnSync(process.execPath, [launcher, '--profile', 'web', '--help'], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (result.status !== 0) throw new Error('Unable to inspect the DSH web profile');
  const help = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  for (const flag of ['--host', '--port', '--no-open', '--trusted-host']) {
    if (!help.includes(flag)) throw new Error(`DSH web profile does not support ${flag}`);
  }
  return { version };
}

export function startDsh(config, options = {}) {
  const launcher = resolveDshLauncher(config.dshLauncher);
  const inspected = inspectDsh(launcher);
  const args = [launcher, '--profile', 'web', '--host', '127.0.0.1', '--port', String(config.dshPort), '--no-open', '--trusted-host', config.authority];
  const child = spawn(process.execPath, args, {
    cwd: config.workspace,
    env: { ...process.env, ...(config.dshHome ? { DSH_HOME: config.dshHome } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let settled = false;
  let resolveReady;
  let rejectReady;
  let resolveExited;
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const exited = new Promise(resolvePromise => { resolveExited = resolvePromise; });
  const timeout = setTimeout(() => {
    if (!settled) { settled = true; rejectReady(new Error('Timed out waiting for DSH Web')); child.kill(); }
  }, options.startupTimeout ?? 60000);
  timeout.unref();

  const acceptLine = line => {
    if (line.startsWith(READY_PREFIX)) {
      if (settled) return;
      try {
        const localUrl = line.slice(READY_PREFIX.length).split(' (LAN:')[0].trim();
        settled = true;
        clearTimeout(timeout);
        resolveReady({ localUrl: new URL(localUrl), version: inspected.version });
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        rejectReady(error);
        child.kill();
      }
      return;
    }
    options.onLog?.(line.replaceAll(/token=[^\s&)]+/gu, 'token=[redacted]'));
  };
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', acceptLine);
  }
  child.once('error', error => {
    if (!settled) { settled = true; clearTimeout(timeout); rejectReady(error); }
  });
  child.once('exit', (code, signal) => {
    resolveExited({ code, signal });
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      rejectReady(new Error(`DSH exited before readiness (${signal ?? code ?? 'unknown'})`));
    }
  });

  return {
    child,
    ready,
    exited,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise(resolvePromise => {
        child.once('exit', resolvePromise);
        const force = setTimeout(() => child.kill('SIGKILL'), 5000);
        force.unref();
      });
    },
  };
}
