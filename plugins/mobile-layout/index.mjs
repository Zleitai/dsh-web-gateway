import { readFileSync } from 'node:fs';

const name = 'mobile-layout';
const STYLE_PATH = '/__dsh_mobile_layout.css';
const STYLE = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8');

const inject = ['webServer'];

function injectLink(html) {
  if (html.includes(`href="${STYLE_PATH}"`)) return html;
  const end = html.lastIndexOf('</head>');
  if (end < 0) return html;
  return `${html.slice(0, end)}<link rel="stylesheet" href="${STYLE_PATH}">\n${html.slice(end)}`;
}

function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: STYLE_PATH,
      handler(request, response) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { allow: 'GET, HEAD' });
          response.end();
          return;
        }
        response.writeHead(200, {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : STYLE);
      },
    }),
    'mobile-layout: stylesheet route',
  );
  ctx.effect(() => ctx.webServer.tapIndex(injectLink), 'mobile-layout: index stylesheet');
}

export { STYLE, STYLE_PATH, apply, inject, injectLink, name };
