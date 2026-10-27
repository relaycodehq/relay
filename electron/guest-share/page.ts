import { createHash } from "node:crypto";
import type { GuestPageView } from "../../shared/guest-share";
import {
  LIGHT_RENDER_THEME,
  withSeries,
  type RenderTheme,
} from "../../shared/html-render";
import { providerMarks } from "../../shared/provider-marks";
import { GUEST_SCRIPT } from "./page-script";
import { GUEST_STYLE } from "./page-style";

/** The colours a show_html page gets on a dark guest page: Relay's dark theme. */
const DARK_RENDER_THEME: RenderTheme = {
  scheme: "dark",
  vars: {
    ...LIGHT_RENDER_THEME.vars,
    "--text": "#e1e1e5",
    "--muted": "#94949f",
    "--surface": "#1e1e21",
    "--background": "#1e1e21",
    "--border": "#37373d",
    "--hover": "#34343c",
    "--accent": "#aaa8e5",
    "--accent-soft": "#32313f",
    "--accent-foreground": "#22222a",
    "--code-background": "#1e1e21",
    "--code-foreground": "#dedee6",
  },
};

const THEMES = {
  light: withSeries(LIGHT_RENDER_THEME),
  dark: withSeries(DARK_RENDER_THEME),
};

// The script never changes, so the policy names it by hash; the thread rides
// along as JSON, which doesn't run.
const SCRIPT_HASH = createHash("sha256").update(GUEST_SCRIPT).digest("base64");

const CSP = [
  "default-src 'none'",
  `script-src 'sha256-${SCRIPT_HASH}'`,
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The page a guest's browser opens, with the thread in it so it shows at once. */
export function guestPage(data: { view: GuestPageView; known: string }) {
  const json = JSON.stringify({
    ...data,
    themes: THEMES,
    marks: providerMarks,
  }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Shared thread · Relay</title>
<style>${GUEST_STYLE}</style>
</head>
<body>
<header class="titlebar"><div class="column titlebar-inner">
  <span class="crumb">Shared thread</span><span class="crumb-sep">/</span><h1 id="title"></h1>
  <a id="continue" class="button" title="Carry this conversation on in a new thread of your own Relay">Continue in Relay</a>
</div></header>
<main class="column">
  <ol id="messages" class="messages" aria-live="polite"></ol>
  <p id="working" hidden><span class="working-dot"></span>Working…</p>
  <section id="files" class="files" hidden><h2>Files the agent changed and read</h2><ul id="file-list"></ul></section>
  <section id="yours" class="yours" hidden><h2>Your suggestions</h2><ul id="suggestions"></ul></section>
</main>
<div class="dock"><form id="suggest" class="composer column">
  <textarea id="text" rows="3" maxlength="4000" placeholder="Suggest a message. The person who shared this decides what reaches the agent." required></textarea>
  <div class="composer-tools">
    <label class="name"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg><input id="name" maxlength="40" placeholder="Your name" autocomplete="name" required></label>
    <span id="status" role="status"></span>
    <button id="send" class="send" type="submit" aria-label="Suggest" title="Suggest (Ctrl/⌘ Enter)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
  </div>
</form></div>
<dialog id="viewer" class="viewer"><div class="viewer-head"><span id="viewer-path"></span><button id="viewer-close" type="button">Close</button></div><div id="viewer-body" class="viewer-body"></div></dialog>
<dialog id="lightbox" class="lightbox"><img id="lightbox-image" alt=""></dialog>
<div id="ended" hidden><h2>This link has ended</h2><p>The person who shared this thread stopped sharing it, or it ran out.</p></div>
<script type="application/json" id="relay-guest-data">${json}</script>
<script>${GUEST_SCRIPT}</script>
</body>
</html>`;
  return { html, csp: CSP };
}
