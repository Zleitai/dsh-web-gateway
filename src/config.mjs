import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const valueFlags = new Set(['public-origin', 'workspace', 'port', 'admin-port', 'dsh-home', 'dsh-launcher']);

export function parseArgs(argv, env = process.env) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (!valueFlags.has(name)) throw new Error(`Unknown option: --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    if (values.has(name)) throw new Error(`Duplicate option: --${name}`);
    values.set(name, value);
    index += 1;
  }

  const publicOrigin = normalizePublicOrigin(values.get('public-origin') ?? env.DSH_GATEWAY_PUBLIC_ORIGIN);
  const workspace = normalizeDirectory(values.get('workspace') ?? env.DSH_GATEWAY_WORKSPACE, 'workspace');
  const dshHomeValue = values.get('dsh-home') ?? env.DSH_GATEWAY_DSH_HOME;
  const dshHome = dshHomeValue ? normalizeDirectory(dshHomeValue, 'dsh-home') : undefined;
  const launcherValue = values.get('dsh-launcher') ?? env.DSH_GATEWAY_DSH_LAUNCHER;
  const dshLauncher = launcherValue ? normalizeFile(launcherValue, 'dsh-launcher') : undefined;

  return {
    publicOrigin,
    authority: new URL(publicOrigin).host,
    workspace,
    dshHome,
    dshLauncher,
    port: integer(values.get('port') ?? env.DSH_GATEWAY_PORT ?? '3090', 'port', true),
    adminPort: integer(values.get('admin-port') ?? env.DSH_GATEWAY_ADMIN_PORT ?? '3091', 'admin-port', false),
  };
}

export function normalizePublicOrigin(input) {
  if (!input) throw new Error('Missing --public-origin');
  let url;
  try { url = new URL(input); } catch { throw new Error('public-origin must be a valid HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('public-origin must be an HTTPS origin without credentials, path, query, or fragment');
  }
  return url.origin;
}

function normalizeDirectory(input, name) {
  if (!input) throw new Error(`Missing --${name}`);
  const path = resolve(input);
  if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${name} must be an existing directory`);
  }
  return path;
}

function normalizeFile(input, name) {
  const path = resolve(input);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${name} must be an existing file`);
  return path;
}

function integer(input, name, allowZero) {
  const value = Number(input);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > 65535) {
    throw new Error(`${name} must be an integer from ${minimum} to 65535`);
  }
  return value;
}
