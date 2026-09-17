import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLE, STYLE_PATH, apply, injectLink } from '../plugins/mobile-layout/index.mjs';

test('mobile layout injects one local stylesheet link', () => {
  const html = '<!doctype html><html><head><title>DSH</title></head><body></body></html>';
  const injected = injectLink(html);
  assert.match(injected, new RegExp(`<link rel="stylesheet" href="${STYLE_PATH}">`));
  assert.equal(injectLink(injected), injected);
  assert.match(STYLE, /@media \(max-width: 640px\)/);
  assert.match(STYLE, /role="dialog"/);
});

test('mobile layout route is read-only and disposable', () => {
  let route;
  let tap;
  const effects = [];
  const ctx = {
    effect(factory) { effects.push(factory); return factory; },
    webServer: {
      register(value) { route = value; return () => {}; },
      tapIndex(value) { tap = value; return () => {}; },
    },
  };
  apply(ctx);
  effects.forEach(effect => effect());
  assert.equal(route.path, STYLE_PATH);
  assert.equal(typeof tap, 'function');

  const response = fakeResponse();
  route.handler({ method: 'GET' }, response);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(response.body, STYLE);

  const rejected = fakeResponse();
  route.handler({ method: 'POST' }, rejected);
  assert.equal(rejected.status, 405);
});

function fakeResponse() {
  return {
    body: undefined,
    headers: undefined,
    status: undefined,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = body; },
  };
}
