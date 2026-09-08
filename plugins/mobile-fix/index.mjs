/** DSH plugin serving mobile styles and injecting them into the Web UI. */
import z from "@deepseek-ai/schemastery";

// Stable Cordis plugin name. The patch entry's `id` is the load-time key,
// the name is what Loader resolves to a file path.
const name = "mobile-fix";
const MOBILE_CSS_PATH = "/__dsh_mobile_fix.css";

// Mobile stylesheet body. Verbatim from outputs/dsh-cloudflare-proxy.mjs
// `MOBILE_FIX_CSS` (kept inline so an edit reloads with the plugin -- no
// extra IO at request time).
const MOBILE_FIX_CSS = `@media (max-width: 640px) {
  :root {
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }

  html,
  body {
    width: 100%;
    height: 100%;
    max-width: 100%;
    overscroll-behavior: none;
    overflow-x: hidden;
  }

  body {
    min-height: 100dvh;
  }

  input,
  textarea,
  select {
    /* iOS Safari zooms the whole UI when a smaller form control receives focus. */
    font-size: 16px !important;
  }

  button,
  [role="button"],
  a,
  select {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  /* Main application frame.  Keep the useful 56px navigation rail, give the
     conversation every remaining pixel, and turn Details into a full pane. */
  [class*="_frame"] {
    height: 100dvh !important;
    max-width: 100vw;
  }

  [data-sidebar-collapsed] {
    grid-template-columns: 56px minmax(0, 1fr) 0 !important;
  }

  [data-sidebar-collapsed]:not([data-details-collapsed]) {
    grid-template-columns: 56px 0 minmax(0, 1fr) !important;
  }

  [class*="_frame"]:not([data-sidebar-collapsed]) {
    /* Drawer-style sidebar on phones: it overlays, content column hidden. */
    grid-template-columns: min(84vw, 320px) 0 0 !important;
  }

  [class*="_sidebarCol"],
  [class*="_centerCol"],
  [class*="_detailsCol"] {
    min-width: 0 !important;
    max-width: 100vw;
  }

  [class*="_detailsCol"] {
    overflow: hidden !important;
  }

  [class*="_centerCol"] {
    overflow: hidden !important;
  }

  /* When the sidebar drawer is open on phones, hide the center column content
     so hero/composer elements do not peek out from behind the drawer. */
  [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_centerCol"] {
    visibility: hidden !important;
  }

  /* Details panel on phones: the desktop third column is unusably narrow,
     so hide the empty placeholder and turn a selected tool call into a
     full-screen overlay. Entry point is tapping a tool row in the stream. */
  [class*="_detailsCol"]:has([class*="_body"] > [class*="_empty"]) {
    visibility: hidden !important;
  }

  [class*="_detailsCol"]:not(:has([class*="_body"] > [class*="_empty"])) {
    position: fixed !important;
    inset: 0 !important;
    z-index: 90 !important;
    width: 100vw !important;
    height: 100dvh !important;
    background: var(--dsw-alias-bg-base) !important;
    visibility: visible !important;
  }

  [class*="_detailsCol"]:not(:has([class*="_body"] > [class*="_empty"])) [class*="_root"] {
    width: 100% !important;
    height: 100% !important;
    border-left: none !important;
    padding-top: env(safe-area-inset-top) !important;
    box-sizing: border-box !important;
  }

  /* Sidebar session titles: ellipsis instead of clipped text. */
  [class*="_sidebarCol"] [class*="_title"] {
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    min-width: 0 !important;
  }

  [class*="_handle"] {
    display: none !important;
  }

  /* Conversation header, tabs, transcript, hero and composer. */
  [data-phase] [class*="_header"] {
    min-width: 0;
    padding: 8px 12px 0 !important;
  }

  [data-phase] [class*="_titleRow"],
  [data-phase] [class*="_titleCluster"],
  [data-phase] [class*="_headerActions"],
  [data-phase] [class*="_headerUtilities"] {
    min-width: 0 !important;
    gap: 6px !important;
  }

  [data-phase] [class*="_crumbs"] {
    min-width: 0;
    overflow: hidden;
  }

  [data-phase] [class*="_crumb"] {
    max-width: min(48vw, 180px) !important;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-phase] [class*="_tabs"] {
    gap: 20px !important;
    overflow-x: auto;
    scrollbar-width: none;
  }

  [data-phase] [class*="_tabs"]::-webkit-scrollbar {
    display: none;
  }

  [data-phase] [class*="_scrollBody"] {
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
  }

  [data-phase] [class*="_composerSeat"] {
    min-width: 0;
  }

  [data-phase] [class*="_composerSeat"] [class*="_card"] {
    max-width: calc(100vw - 76px) !important;
    border-radius: 18px !important;
  }

  [data-phase] [class*="_composerSeat"] [class*="_row"] {
    gap: 6px !important;
    padding-inline: 6px !important;
    flex-wrap: wrap !important;
  }

  [data-phase] [class*="_composerSeat"] [class*="_tools"],
  [data-phase] [class*="_composerSeat"] [class*="_modes"],
  [data-phase] [class*="_composerSeat"] [class*="_trailing"] {
    gap: 4px !important;
    min-width: 0 !important;
  }

  [data-phase] [class*="_composerSeat"] [class*="_modes"] {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    overflow: visible !important;
  }

  [data-phase] [class*="_composerSeat"] [class*="_trailing"] {
    flex: 0 1 auto !important;
    max-width: 100% !important;
    margin-left: auto !important;
  }

  [data-phase] [class*="_composerSeat"] [class*="_select"],
  [data-phase] [class*="_composerSeat"] [class*="_trigger"] {
    min-width: 0 !important;
    max-width: 180px !important;
  }

  [data-phase] [class*="_composerSeat"] [class*="_triggerLabel"] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-phase='hero'] [class*="_hero"] {
    padding-inline: 12px !important;
  }

  [data-phase='hero'] [class*="_headline"] {
    grid-template-columns: 30px minmax(0, auto) auto !important;
    font-size: 22px !important;
  }

  [data-phase='hero'] [class*="_heroWorkspaceRow"] {
    padding-inline: 4px !important;
    flex-wrap: wrap !important;
    gap: 4px !important;
  }

  [data-phase='hero'] [class*="_heroWorkspaceRow"] [class*="_workspace"],
  [data-phase='hero'] [class*="_heroWorkspaceRow"] [class*="_seat"] {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
  }

  /* Shared modal shell: phone-sized card, scrollable content and wrapping
     actions.  Specific Settings and directory rules below refine it. */
  [class*="_root"]:has(> [role="dialog"][aria-modal="true"]) {
    padding: max(8px, env(safe-area-inset-top)) 8px max(8px, env(safe-area-inset-bottom)) !important;
  }

  [role="dialog"][aria-modal="true"] {
    width: calc(100vw - 16px) !important;
    max-width: calc(100vw - 16px) !important;
    max-height: calc(100dvh - 16px) !important;
    border-radius: 16px !important;
  }

  [role="dialog"][aria-modal="true"] > [class*="_header"] {
    padding: 16px 12px 10px 16px !important;
  }

  [role="dialog"][aria-modal="true"] > [class*="_description"] {
    padding-inline: 16px !important;
  }

  [role="dialog"][aria-modal="true"] > [class*="_body"] {
    min-height: 0;
    padding-inline: 16px !important;
    overflow-y: auto;
  }

  [role="dialog"][aria-modal="true"] > [class*="_footer"] {
    flex-wrap: wrap;
    padding-inline: 16px !important;
    padding-bottom: env(safe-area-inset-bottom) !important;
  }

  [role="dialog"][aria-modal="true"] img,
  [role="dialog"][aria-modal="true"] video,
  [role="dialog"][aria-modal="true"] canvas {
    max-width: 100%;
    height: auto;
  }

  /* DSH SettingsRoot: change the fixed desktop rail into mobile tabs. */
  [role="dialog"][aria-modal="true"]:has(> nav) {
    width: calc(100vw - 16px) !important;
    max-width: calc(100vw - 16px) !important;
    height: calc(100dvh - 16px) !important;
    max-height: calc(100dvh - 16px) !important;
    flex-direction: column !important;
    border-radius: 16px !important;
  }

  [role="dialog"][aria-modal="true"] > nav {
    width: 100% !important;
    padding: max(10px, env(safe-area-inset-top)) 10px 0 !important;
    gap: 8px !important;
    flex: 0 0 auto !important;
    border-bottom: 1px solid var(--dsw-alias-border-l2);
    overflow: hidden !important;
  }

  [role="dialog"][aria-modal="true"] > nav > :first-child {
    min-height: 24px;
    padding: 0 44px 0 4px !important;
  }

  [role="dialog"][aria-modal="true"] > nav > :nth-child(2) {
    display: flex !important;
    flex-direction: row !important;
    gap: 5px !important;
    overflow-x: auto !important;
    overscroll-behavior-x: contain;
    padding-bottom: 8px;
    padding-right: 10px !important;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    min-width: 0 !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }

  [role="dialog"][aria-modal="true"] > nav > :nth-child(2)::-webkit-scrollbar {
    display: none;
  }

  [role="dialog"][aria-modal="true"] > nav button {
    flex: 0 0 auto !important;
    width: auto !important;
    min-height: 40px !important;
    padding: 8px 10px !important;
  }

  [role="dialog"][aria-modal="true"] > div:last-child {
    width: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
  }

  [role="dialog"][aria-modal="true"] > div:last-child > div:first-child {
    position: absolute !important;
    top: 8px;
    right: 8px;
    z-index: 2;
    width: auto !important;
    height: 32px !important;
    padding: 0 !important;
  }

  [role="dialog"][aria-modal="true"] > div:last-child > div:last-child {
    padding: 8px 14px calc(16px + env(safe-area-inset-bottom)) !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
  }

  [role="dialog"][aria-modal="true"] select,
  [role="dialog"][aria-modal="true"] input,
  [role="dialog"][aria-modal="true"] textarea,
  [role="dialog"][aria-modal="true"] button {
    max-width: 100%;
  }

  /* Model and Agent-preset settings: desktop grids become one readable
     column. The second model text field gets its own full-width row. */
  [role="dialog"]:has(> nav) [class*="_rowHead"],
  [role="dialog"]:has(> nav) [class*="_rowActions"],
  [role="dialog"]:has(> nav) [class*="_editorHeader"],
  [role="dialog"]:has(> nav) [class*="_editorActions"],
  [role="dialog"]:has(> nav) [class*="_addActions"],
  [role="dialog"]:has(> nav) [class*="_modelListHead"] {
    flex-wrap: wrap !important;
  }

  [role="dialog"]:has(> nav) [class*="_modelRow"] {
    grid-template-columns: minmax(0, 1fr) auto auto !important;
  }

  [role="dialog"]:has(> nav) [class*="_modelRow"] > :nth-child(2) {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  [role="dialog"]:has(> nav) [class*="_modelAdvanced"],
  [role="dialog"]:has(> nav) [class*="_cards"],
  [role="dialog"]:has(> nav) [class*="_pluginGrid"],
  [role="dialog"]:has(> nav) [class*="_catalogGrid"] {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  [role="dialog"]:has(> nav) [class*="_card"],
  [role="dialog"]:has(> nav) [class*="_editor"],
  [role="dialog"]:has(> nav) [class*="_field"] {
    min-width: 0 !important;
    max-width: 100% !important;
  }

  [role="dialog"]:has(> nav) code,
  [role="dialog"]:has(> nav) pre {
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  /* Directory picker: each Miller column occupies one phone screen. DSH's
     own active-column scrolling then behaves like a native drill-down list. */
  [role="dialog"] [class*="_header"]:has(+ [class*="_content"]) {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 6px !important;
    padding: 12px 12px 8px 16px !important;
  }

  [role="dialog"] [class*="_header"]:has(+ [class*="_content"]) [class*="_title"] {
    align-self: stretch !important;
    min-height: auto !important;
  }

  [role="dialog"] [class*="_header"]:has(+ [class*="_content"]) [class*="_crumbBar"] {
    align-self: stretch !important;
    margin-left: 0 !important;
    padding: 0 4px !important;
  }

  [role="dialog"] [class*="_header"]:has(+ [class*="_content"]) [class*="_crumbEditZone"] {
    flex: 0 0 auto !important;
    min-width: 28px !important;
  }

  [role="dialog"] [class*="_content"]:has([class*="_millerRow"]) {
    padding: 10px 8px 10px 12px !important;
  }

  [role="dialog"] [class*="_millerRow"] {
    gap: 0 !important;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }

  [role="dialog"] [class*="_millerRow"] > [class*="_column"] {
    flex: 0 0 100% !important;
    min-width: 100% !important;
    padding-right: 4px !important;
    scroll-snap-align: start;
  }

  [role="dialog"] [class*="_millerRow"] > [class*="_divider"] {
    display: none;
  }

  [role="dialog"] [class*="_footerBar"] {
    flex-wrap: wrap !important;
    gap: 8px !important;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom)) !important;
  }

  [role="dialog"] [class*="_footerBar"] [class*="_footerGap"] {
    display: none;
  }

  [role="dialog"] [class*="_footerBar"] > button {
    flex: 1 1 auto !important;
    min-height: 44px !important;
  }

  [role="dialog"] [class*="_footerBar"] [class*="_showHiddenToggle"] {
    padding: 0 8px !important;
    justify-content: center !important;
  }

  [role="dialog"] [class*="_footerBar"] [class*="_footerAction"]:last-child {
    flex: 1 1 100% !important;
  }

  /* Tooltips: on phones they easily get stuck after a tap/focus because there
     is no clean pointer-leave. Hide all tooltip bubbles in the mobile breakpoint. */
  [role="tooltip"],
  [class*="_bubble"][role="tooltip"] {
    display: none !important;
  }

  /* Menus become bottom sheets, which avoids clipped portal coordinates and
     off-screen nested submenus on iPhone Safari. Cover the full viewport width
     (over the sidebar rail) and sit above modals/dialogs. */
  [class*="_list"][class*="_portal"],
  [class*="_menu"]:not([class*="_menuButton"]),
  [class*="_menu"][role="menu"],
  [class*="_menu"][role="listbox"],
  [role="menu"],
  [role="listbox"] {
    box-sizing: border-box !important;
    position: fixed !important;
    z-index: 1100 !important;
    left: 8px !important;
    right: 8px !important;
    top: auto !important;
    bottom: calc(8px + env(safe-area-inset-bottom)) !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    max-height: min(68dvh, 560px) !important;
    border-radius: 16px !important;
  }

  /* ModelSelect and other custom menus that live inside a relative wrapper:
     force them out of their containing block so they span the viewport. */
  [class*="_root"]:has(> [class*="_menu"]) > [class*="_menu"],
  [class*="_root"]:has(> [class*="_trigger"]) > [class*="_menu"] {
    box-sizing: border-box !important;
    position: fixed !important;
    z-index: 1100 !important;
    left: 8px !important;
    right: 8px !important;
    top: auto !important;
    bottom: calc(8px + env(safe-area-inset-bottom)) !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    max-height: min(68dvh, 560px) !important;
    border-radius: 16px !important;
  }

  [class*="_submenu"] {
    position: fixed !important;
    left: 8px !important;
    right: 8px !important;
    top: 50% !important;
    bottom: auto !important;
    width: auto !important;
    min-width: 0 !important;
    max-height: 68dvh !important;
    transform: translateY(-50%);
    overflow-y: auto;
    border-radius: 16px !important;
  }

  [role="menu"] button,
  [role="listbox"] button,
  [role="option"] {
    min-height: 44px !important;
  }

  /* Long generated content, tool cards, tables and file paths stay inside the
     conversation rather than increasing the document width. */
  [data-phase] pre,
  [data-phase] code,
  [data-phase] table,
  [data-phase] [class*="_bodyScroll"],
  [data-phase] [class*="_viewerCode"] {
    max-width: 100%;
  }

  [data-phase] pre,
  [data-phase] table,
  [data-phase] [class*="_bodyScroll"] {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  [data-phase] img,
  [data-phase] video {
    max-width: 100%;
    height: auto;
  }

  [class*="_noteInput"],
  [class*="_panel"][class*="_panel"] {
    max-width: calc(100vw - 80px) !important;
  }
}

@media (max-width: 380px) {
  [data-phase] [class*="_composerSeat"] [class*="_select"],
  [data-phase] [class*="_composerSeat"] [class*="_trigger"] {
    max-width: 140px !important;
  }

  [data-phase='hero'] [class*="_headline"] {
    font-size: 20px !important;
  }
}`;

// Service required before the route registration can run.
const inject = ["webServer"];

// Plugin config: only one knob today. Disable to temporarily turn off mobile
// styles (e.g., desktop-only debugging) without uninstalling the plugin.
const Config = z.object({
  enabled: z.boolean().default(true),
});

/** Inject the stylesheet <link> before </head>; pass-through if absent. */
function injectLink(html) {
  const tag = `<link rel="stylesheet" href="${MOBILE_CSS_PATH}">`;
  const headEnd = html.lastIndexOf("</head>");
  if (headEnd === -1) return html;
  return html.slice(0, headEnd) + tag + "\n" + html.slice(headEnd);
}

/** Register the stylesheet route and the index transform. */
function apply(ctx, config) {
  const { enabled } = config;
  if (!enabled) {
    ctx.logger.info("mobile-fix: disabled by config");
    return;
  }

  // Exact route: no gate, no index-tap involvement, content-type matches what
  // <link rel="stylesheet"> expects. Node strips the body for HEAD responses
  // automatically, so the same handler answers both.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: MOBILE_CSS_PATH,
        handler(_req, res) {
          res.writeHead(200, {
            "content-type": "text/css; charset=utf-8",
          });
          res.end(MOBILE_FIX_CSS);
        },
      }),
    "mobile-fix: /__dsh_mobile_fix.css route",
  );

  // Index transform: runs on every SPA /index.html response (frontend-static
  // calls applyIndexTaps before writeHead). Order with other taps matters for
  // any tap that depends on our <link> being present; ours is independent.
  ctx.effect(
    () => ctx.webServer.tapIndex(injectLink),
    "mobile-fix: <link> inject tap",
  );
}

export { Config, apply, inject, name };
