import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import schema from '@deepseek-ai/schemastery';
import QRCode from 'qrcode';
import { endpoint, ready, sessionIdSchema } from '@dsh-mobile/protocol';
import { z } from 'zod';
import { DshAdapter, type HarnessServices } from './adapter.js';
import { HostStore } from './store.js';
import { HostController } from './controller.js';
import { HostTransport } from './transport.js';
import { adminHtml, adminJs } from './admin.js';
import type { Interaction } from './interactions.js';

export const name = 'dsh-mobile-control';
export const inject = ['connection', 'webServer', 'sessionController', 'workspaceRegistry', 'sessions'];
export const Config = schema.object({
  enabled: schema.boolean().default(true),
  relayUrl: schema.string().default(''),
  mobileUrl: schema.string().default(''),
});
export interface PluginConfig { enabled: boolean; relayUrl: string; mobileUrl: string }
interface ApprovalEvent { agent?: { session: { id: string } }; toolName?: string; reason?: string; questions?: Interaction['questions']; signal?: AbortSignal }
interface PluginContext extends HarnessServices {
  baseDir?: string;
  connection: { requestRejection(request: IncomingMessage): number | undefined };
  webServer: {
    register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }): () => void;
  };
  effect(fn: () => (() => void | Promise<void>), label?: string): unknown;
  on(event: string, listener: (this: unknown, request: ApprovalEvent, next: () => Promise<unknown>) => Promise<unknown>, options?: { prepend: boolean; global: boolean }): unknown;
  logger: { info(text: string): void };
}
const adminRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), invite: z.string().max(200) }).strict(),
  z.object({ action: z.literal('share'), ids: z.array(z.string().uuid()).max(100) }).strict(),
  z.object({ action: z.literal('pair') }).strict(),
  z.object({ action: z.literal('confirm'), id: z.string().uuid(), allowed: z.boolean() }).strict(),
  z.object({ action: z.literal('revoke'), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('answer'), sessionId: sessionIdSchema, id: z.string().uuid(), answer: z.enum(['allowed-once', 'rejected']) }).strict(),
]);
function installedVersion(): string {
  // Resolve from the actual DSH launcher, never from a separately installed global copy.
  const launcher = createRequire(process.argv[1] ?? import.meta.url);
  const path = launcher.resolve('@deepseek-ai/dsh-api-session-controller/package.json');
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}
function localRequest(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip ?? '')) return false;
  try {
    const host = new URL('http://' + req.headers.host);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false;
    return req.method === 'GET' || req.method === 'HEAD' || (req.headers.origin === host.origin && req.headers['sec-fetch-site'] !== 'cross-site');
  } catch { return false; }
}
async function body(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) { text += String(chunk); if (Buffer.byteLength(text) > 16384) throw new Error('REQUEST_TOO_LARGE'); }
  return JSON.parse(text) as unknown;
}

export async function apply(ctx: PluginContext, config: PluginConfig): Promise<void> {
  await ready;
  let compatibilityError = '';
  try { if (installedVersion() !== '0.1.2-rc.1') compatibilityError = '仅支持 DSH 0.1.2-rc.1'; } catch { compatibilityError = '无法确认 DSH 版本，远程控制已停用'; }
  const capabilities = { list: ctx.sessionController?.list, create: ctx.sessionController?.create, prompt: ctx.sessionController?.prompt, cancel: ctx.sessionController?.cancel, page: ctx.sessionController?.page, follow: ctx.sessionController?.follow, workspaces: ctx.workspaceRegistry?.list, checkpoint: ctx.sessions?.flush };
  const missing = Object.entries(capabilities).filter(([, method]) => typeof method !== 'function').map(([name]) => name);
  if (missing.length) compatibilityError = 'DSH 缺少所需能力：' + missing.join(', ');
  const store = new HostStore(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'mobile-control', 'host.sqlite'));
  const controller = new HostController(store, new DshAdapter(ctx));
  let transport: HostTransport | undefined; let registering = false; let startupError = '';
  const configured = () => {
    if (!config.enabled) throw new Error('PLUGIN_DISABLED');
    if (compatibilityError) throw new Error('HARNESS_VERSION_UNSUPPORTED');
    endpoint(config.relayUrl, '/'); endpoint(config.mobileUrl, '/');
  };
  function start() {
    configured();
    const registration = store.get<{ hostId: string; token: string; relayUrl: string }>('registration');
    if (!registration) return;
    if (registration.relayUrl !== config.relayUrl) throw new Error('RELAY_CHANGED_REPAIR_REQUIRED');
    transport = new HostTransport(controller, config.relayUrl, registration); transport.start();
  }
  try { start(); } catch (error) { startupError = error instanceof Error ? error.message : 'CONFIGURATION_ERROR'; }
  ctx.effect(() => () => { controller.close(); return (transport?.stop() ?? Promise.resolve()).then(() => store.close()); }, 'mobile-control: lifecycle');

  for (const [event, kind] of [['approval/request', 'approval'], ['user-questions/request', 'question']] as const) {
    ctx.on(event, async function(request, next) {
      const sessionId = request.agent?.session.id;
      if (!sessionId) return next();
      try { controller.sessionWorkspace(sessionId); } catch { return next(); }
      return controller.interactions.ask({ sessionId, kind, ...(request.toolName ? { toolName: request.toolName } : {}), ...(request.reason ? { reason: request.reason } : {}), ...(request.questions ? { questions: request.questions } : {}) }, request.signal, next, transport?.hasPhone() ?? false);
    }, { prepend: true, global: true });
  }
  const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    if (!localRequest(req)) { json(res, 403, { error: 'LOCAL_MANAGEMENT_ONLY' }); return; }
    const rejected = ctx.connection.requestRejection(req);
    if (rejected !== undefined) { json(res, rejected, { error: '请先在此浏览器登录 DSH，再打开 /mobile-control' }); return; }
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/mobile-control' && req.method === 'GET') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(adminHtml); return; }
    if (path === '/mobile-control/app.js' && req.method === 'GET') { res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.end(adminJs); return; }
    if (path !== '/mobile-control/api') { json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
    if (req.method === 'GET') {
      json(res, 200, { state: transport?.state ?? 'stopped', error: compatibilityError || (!config.relayUrl || !config.mobileUrl ? '请配置 relayUrl 和 mobileUrl' : startupError), workspaces: (compatibilityError ? [] : controller.adapter.workspaces()).map(w => ({ id: w.id, title: w.title, path: w.path })), shared: controller.shared().map(w => w.id), devices: store.devices().map(({ publicKey: _, ...rest }) => rest), pending: controller.pending(), interactions: controller.shared().flatMap(w => w.sessionIds.flatMap(id => controller.interactions.list(id))) }); return;
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
    try {
      configured(); const action = adminRequest.parse(await body(req));
      switch (action.action) {
        case 'register': {
          if (store.get('registration')) { if (!transport) start(); break; }
          if (registering) throw new Error('REGISTRATION_PENDING');
          registering = true;
          try {
            const response = await fetch(endpoint(config.relayUrl, '/v1/hosts'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite: action.invite }), signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error('RELAY_REGISTRATION_FAILED');
            const record = z.object({ hostId: z.string().uuid(), token: z.string().min(40).max(100) }).strict().parse(await response.json());
            store.set('registration', { ...record, relayUrl: config.relayUrl }); start();
          } finally { registering = false; }
          break;
        }
        case 'share': controller.share(action.ids); break;
        case 'revoke': controller.revoke(action.id); break;
        case 'confirm': controller.confirm(action.id, action.allowed); break;
        case 'answer': controller.sessionWorkspace(action.sessionId); controller.interactions.answer(action.sessionId, action.id, action.answer); break;
        case 'pair': {
          const record = store.get<{ hostId: string }>('registration');
          if (!record || transport?.state !== 'connected') throw new Error('RELAY_NOT_CONNECTED');
          const pairing = controller.pair(record.hostId, config.relayUrl);
          const url = new URL(config.mobileUrl); url.hash = 'pair=' + encodeURIComponent(JSON.stringify(pairing));
          json(res, 200, { url: url.toString(), qr: await QRCode.toDataURL(url.toString(), { errorCorrectionLevel: 'M', width: 300 }) }); return;
        }
      }
      json(res, 200, { ok: true });
    } catch (error) { json(res, 400, { error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : '操作失败，请检查配置和输入' }); }
  };
  for (const path of ['/mobile-control', '/mobile-control/app.js', '/mobile-control/api']) ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), 'mobile-control: admin route');
  ctx.logger.info('Mobile Control management: /mobile-control (local authenticated browser only)');
}
