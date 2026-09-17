import http from 'node:http';
import QRCode from 'qrcode';

const headers = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export async function startAdmin({ port, publicUrl, version }) {
  const svg = await QRCode.toString(publicUrl, { type: 'svg', errorCorrectionLevel: 'M', width: 320, margin: 2 });
  const origin = new URL(publicUrl).origin;
  const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Web Gateway</title><style>body{font:16px system-ui;margin:0;background:#f5f7f6;color:#17231e}.card{max-width:480px;margin:5vh auto;padding:24px;background:white;border-radius:20px;box-shadow:0 8px 30px #173c2c18}img{display:block;max-width:320px;width:100%;margin:20px auto}a{display:block;padding:13px 16px;border-radius:12px;background:#174c3d;color:white;text-decoration:none;text-align:center}.muted{color:#617069;font-size:14px;overflow-wrap:anywhere}</style></head><body><main class="card"><h1>DSH 手机入口</h1><p>手机扫描二维码，或在本机打开认证入口。二维码包含本次 DSH 进程的登录凭据，请勿分享。</p><img src="/pair.svg" alt="DSH 手机认证二维码"><a href="${escapeHtml(publicUrl)}">打开 ${escapeHtml(origin)}</a><p class="muted">DSH ${escapeHtml(version)} · 管理页仅监听本机回环地址</p></main></body></html>`;
  const server = http.createServer((request, response) => {
    if (!isLocal(request)) { response.writeHead(403, headers).end(); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, headers).end(); return; }
    if (request.url === '/') response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' }).end(page);
    else if (request.url === '/pair.svg') response.writeHead(200, { ...headers, 'content-type': 'image/svg+xml' }).end(svg);
    else if (request.url === '/health') response.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', dshVersion: version, publicOrigin: origin }));
    else response.writeHead(404, headers).end();
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolvePromise, rejectPromise) => server.close(error => error ? rejectPromise(error) : resolvePromise())),
  };
}

function isLocal(request) {
  const address = request.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')) return false;
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${request.headers.host}`).hostname); }
  catch { return false; }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
