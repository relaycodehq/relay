import { createHash } from "node:crypto";
import type { GuestPageView } from "../../shared/guest-share";
import {
  LIGHT_RENDER_THEME,
  withSeries,
  type RenderTheme,
} from "../../shared/html-render";
import { GUEST_SCRIPT } from "./page-script";
import { GUEST_STYLE } from "./page-style";

/** The colours a show_html page gets on a dark guest page. */
const DARK_RENDER_THEME: RenderTheme = {
  scheme: "dark",
  vars: {
    ...LIGHT_RENDER_THEME.vars,
    "--text": "#e7e7ea",
    "--muted": "#94949f",
    "--surface": "#1f1f23",
    "--background": "#1f1f23",
    "--border": "#2e2e33",
    "--hover": "#2a2a30",
    "--accent": "#a3a3e6",
    "--accent-soft": "#2b2b40",
    "--accent-foreground": "#18181b",
    "--code-background": "#232328",
    "--code-foreground": "#e7e7ea",
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
  const json = JSON.stringify({ ...data, themes: THEMES }).replace(
    /</g,
    "\\u003c",
  );
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
<header class="top"><div class="top-inner">
  <div class="top-title"><h1 id="title"></h1><p>Shared from Relay. Suggest messages; the person who shared it decides what reaches the agent.</p></div>
  <a id="continue" class="continue" title="Carry this conversation on in a new thread of your own Relay">Continue in Relay</a>
</div></header>
<main>
  <ol id="messages" class="messages" aria-live="polite"></ol>
  <p id="working" hidden>The agent is working…</p>
  <section id="files" class="files" hidden><h2>Files the agent changed and read</h2><ul id="file-list"></ul></section>
  <section id="yours" class="yours" hidden><h2>Your suggestions</h2><ul id="suggestions"></ul></section>
</main>
<form id="suggest" class="suggest">
  <input id="name" maxlength="40" placeholder="Your name" autocomplete="name" required>
  <textarea id="text" rows="3" maxlength="4000" placeholder="Suggest a message…" required></textarea>
  <div class="row"><span id="status" role="status"></span><button id="send" class="primary" type="submit">Suggest</button></div>
</form>
<dialog id="viewer" class="viewer"><div class="viewer-head"><span id="viewer-path"></span><button id="viewer-close" type="button">Close</button></div><div id="viewer-body" class="viewer-body"></div></dialog>
<p id="ended" hidden>This link has ended.</p>
<script type="application/json" id="relay-guest-data">${json}</script>
<script>${GUEST_SCRIPT}</script>
</body>
</html>`;
  return { html, csp: CSP };
}
