import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { TestPhone } from './wire-client.mjs';
export const name = 'mobile-integration-fixture';
export const inject = ['sessionController', 'workspaceRegistry', 'llm', 'approval', 'userQuestions', 'sessions', 'connection', 'webServer'];
export async function apply(ctx) {
  const requireDsh = createRequire(process.env.DSH_TEST_LAUNCHER);
  const { LlmAdapter } = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-llm')));
  const { DshAdapter } = await import(pathToFileURL(join(process.env.DSH_TEST_ROOT, 'packages/host/dist/index.js')));
  const mobilePlugin = await import(pathToFileURL(process.env.DSH_TEST_PLUGIN ?? join(process.env.DSH_TEST_ROOT, 'packages/host/dist/plugin.js')));
  const { createRelay } = await import(pathToFileURL(join(process.env.DSH_TEST_ROOT, 'apps/relay/dist/server.js')));
  const checks = [];
  let activeAgent; let hold = false; let streamEntered = false; let phone;
  class TestAdapter extends LlmAdapter {
    async *stream(options) {
      if (options.purpose) {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: 'Integration task' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Integration task' } };
        yield { type: 'finish', reason: { kind: 'stop' } }; return;
      }
      streamEntered = true;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'mobile-stream' };
      if (hold) {
        await new Promise(r => { if (options.signal.aborted) r(); else options.signal.addEventListener('abort', r, { once: true }); });
        return;
      }
      const pending = ctx.approval.request({ agent: activeAgent, toolName: 'mobile-fixture', reason: 'integration', signal: options.signal });
      let ask;
      await until(async () => { const reply = await phone.call('interactions.list', { sessionId: activeAgent.session.id }); ask = reply.data?.[0]; return !!ask; });
      assert.equal((await phone.call('interactions.answer', { sessionId: activeAgent.session.id, interactionId: ask.id, answer: 'allowed-once' })).ok, true);
      assert.equal(await pending, 'allowed-once');
      assert.equal((await phone.call('interactions.answer', { sessionId: activeAgent.session.id, interactionId: ask.id, answer: 'rejected' })).error.code, 'INTERACTION_EXPIRED');
      const question = ctx.userQuestions.ask({ agent: activeAgent, signal: options.signal, questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'Continue' }] }] });
      await until(async () => { const reply = await phone.call('interactions.list', { sessionId: activeAgent.session.id }); ask = reply.data?.find(i => i.kind === 'question'); return !!ask; });
      const answer = { answers: [{ id: 'choice', selected: ['Continue'] }] };
      assert.equal((await phone.call('interactions.answer', { sessionId: activeAgent.session.id, interactionId: ask.id, answer })).ok, true);
      assert.deepEqual(await question, answer);
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'mobile-stream' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['mobile-fixture'], new TestAdapter());
  setTimeout(() => run().then(() => finish({ ok: true, checks }), error => finish({ ok: false, error: error.stack + '\nLast turn: ' + JSON.stringify(activeAgent?.session.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)?.data) + '\nEvents: ' + JSON.stringify(activeAgent?.session.snapshotEvents().map(e => ({ seq: e.seq, type: e.type }))) })), 500);
  async function run() {
    const relay = createRelay({ database: ':memory:', allowedOrigins: [] });
    const relayUrl = await relay.app.listen({ port: 0, host: '127.0.0.1' });
    const fiber = ctx.plugin(mobilePlugin, { enabled: true, relayUrl, mobileUrl: 'http://localhost:5173' });
    const origin = 'http://127.0.0.1:' + process.env.DSH_TEST_PORT;
    const login = await fetch(ctx.connection.authenticatedUrl(origin + '/'), { redirect: 'manual' });
    assert.equal(login.status, 303);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    async function admin(body) {
      const response = await fetch(origin + '/mobile-control/api', { method: body ? 'POST' : 'GET', headers: { cookie, origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 200); return response.json();
    }
    await until(async () => (await fetch(origin + '/mobile-control/api', { headers: { cookie } })).status === 200);
    assert.equal((await fetch(origin + '/mobile-control/api')).status, 401);
    assert.equal((await fetch(origin + '/mobile-control/api', { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await admin()).error, '');
    await admin({ action: 'register', invite: '' });
    await until(async () => (await admin()).state === 'connected');
    const adapter = new DshAdapter(ctx);
    const project = join(process.env.DSH_HOME, 'workspace'); await mkdir(project);
    const workspace = await ctx.workspaceRegistry.create(project, 'Integration workspace');
    await admin({ action: 'share', ids: [workspace.id] });
    const qr = await admin({ action: 'pair' });
    const pair = JSON.parse(new URLSearchParams(new URL(qr.url).hash.slice(1)).get('pair'));
    phone = new TestPhone(pair); const paired = phone.connect();
    await until(async () => (await admin()).pending.length === 1);
    await admin({ action: 'confirm', id: (await admin()).pending[0].id, allowed: true }); await paired;
    checks.push('actual plugin load', 'DSH browser authentication and CSRF', 'QR and desktop confirmation');
    const session = await adapter.create(workspace, randomUUID());
    assert.ok(adapter.workspaces().some(w => w.sessionIds.includes(session.sessionId)));
    checks.push('create and workspace membership');
    const found = await ctx.sessionController.resolveAgent(session.sessionId);
    if (found.error) throw found.error;
    activeAgent = found.agent;
    await ctx.sessionController.selectModel({ sessionId: session.sessionId, provider: 'mobile-fixture', model: 'fixture' });
    const abort = new AbortController(); const observed = [];
    const reading = (async () => { try { for await (const frame of adapter.follow(session.sessionId, abort.signal)) observed.push(...frame.records); } catch (e) { if (!abort.signal.aborted) throw e; } })();
    const requestId = randomUUID();
    assert.equal((await phone.call('sessions.send', { sessionId: session.sessionId, text: 'mobile input' }, requestId)).ok, true);
    await until(() => activeAgent.session.snapshotEvents().some(e => e.type === 'assistant/message'));
    await until(() => observed.some(r => r.text === 'mobile-stream' && r.type === 'assistant/chunk'));
    assert.ok(observed.some(r => r.requestId === requestId && r.text === 'mobile input'));
    assert.ok(await adapter.reconcile(session.sessionId, requestId));
    assert.ok(activeAgent.session.snapshotEvents().some(e => e.type === 'approval/decided' && e.data.outcome === 'allowed-once'));
    checks.push('same live session', 'stream and durable request identity', 'approval audit and first answer', 'structured user question');
    await until(() => activeAgent.status === 'idle');
    // The desktop and phone enter through the same public Session Controller.
    await ctx.sessionController.prompt({ sessionId: session.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'desktop input' }] }, new AbortController().signal);
    await until(() => activeAgent.session.snapshotEvents().filter(e => e.type === 'assistant/message').length >= 2);
    await until(() => activeAgent.status === 'idle');
    hold = true; streamEntered = false;
    await adapter.send(session.sessionId, 'cancel input', randomUUID());
    await until(() => streamEntered);
    assert.equal(activeAgent.status, 'running');
    await phone.call('sessions.cancel', { sessionId: session.sessionId });
    await until(() => activeAgent.status === 'idle');
    checks.push('desktop continuation', 'cancel');
    abort.abort(); await reading;
    const page = await adapter.page(session.sessionId, activeAgent.session.seq - 1, undefined, new AbortController().signal);
    assert.ok(page.records.length > 0);
    checks.push('history');
    // Unload remote control during an active task; the DSH Agent must remain alive.
    streamEntered = false; await adapter.send(session.sessionId, 'unload input', randomUUID()); await until(() => streamEntered);
    await fiber.dispose();
    assert.equal(activeAgent.status, 'running');
    await adapter.cancel(session.sessionId); await until(() => activeAgent.status === 'idle');
    assert.ok((await ctx.sessionController.inspect(session.sessionId)).events.length > 0);
    phone.close(); await relay.app.close();
    checks.push('unload preserves task and history');
  }
  function finish(result) { return writeFile(join(process.env.DSH_HOME, 'result.json'), JSON.stringify(result)); }
}
async function until(predicate) { const deadline = Date.now() + 15000; while (!await predicate()) { if (Date.now() > deadline) throw new Error('Fixture condition timed out'); await new Promise(r => setTimeout(r, 25)); } }
