// Pages an agent shows inside its answer: a chart, a table, a mockup, or a few
// variants of one to pick from. Each page is a self-contained HTML document
// Relay keeps beside the thread and shows in a sandboxed frame, themed like
// the app. Adapted from T3 Code's HTML renders (MIT).

/** A page set the agent showed in its answer; its HTML lives in files beside the thread. */
export interface HtmlRender {
  id: string;
  title: string;
  pages: HtmlRenderPage[];
  created: number;
}
export interface HtmlRenderPage {
  /** Names a variant; absent on a single page. */
  label?: string;
  /** Content height at each of RENDER_WIDTHS, so the frame opens at its size. */
  heights?: number[];
}

/** One page of a render to copy or save; the title names the file. */
export interface RenderTarget {
  chatId: string;
  renderId: string;
  page: number;
  title: string;
}
/** How a page's picture is taken: where its frame sits in the window when it fits there whole, else loaded afresh at `width`. */
export interface RenderShot {
  to: "clipboard" | "file";
  /** In the window's CSS pixels. */
  rect?: { x: number; y: number; width: number; height: number };
  width: number;
  /** Device pixels per CSS pixel, so a fresh load comes out as sharp as the window. */
  scale: number;
}

/** The frame widths a page is measured at; others are interpolated. */
export const RENDER_WIDTHS = [320, 480, 640, 800, 960, 1120];
export const RENDER_MIN_HEIGHT = 80;
export const RENDER_MAX_HEIGHT = 2000;
export const RENDER_MAX_PAGES = 4;
/** One page's HTML; the tools server sizes its body limit from this and the page cap. */
export const RENDER_MAX_CHARS = 200_000;
/** What a page may put in the composer through relay.compose(). */
export const RENDER_COMPOSE_CHARS = 4000;

export const RENDER_SCHEME = "relay-render";
/** Where a page is served from; the main process answers it. */
export const renderUrl = (chatId: string, renderId: string, page: number) =>
  `${RENDER_SCHEME}://render/${chatId}/${renderId}/${page}`;

export const clampRenderHeight = (height: number) =>
  Math.min(RENDER_MAX_HEIGHT, Math.max(RENDER_MIN_HEIGHT, Math.ceil(height)));

/** The height a page needs at `width`, from its measured heights; undefined when unmeasured. */
export function renderHeightAt(heights: number[] | undefined, width: number) {
  if (heights?.length !== RENDER_WIDTHS.length) return undefined;
  const after = RENDER_WIDTHS.findIndex((w) => w >= width);
  if (after === 0) return clampRenderHeight(heights[0]);
  if (after < 0) return clampRenderHeight(heights.at(-1)!);
  const from = RENDER_WIDTHS[after - 1],
    to = RENDER_WIDTHS[after];
  const t = (width - from) / (to - from);
  return clampRenderHeight(
    heights[after - 1] + (heights[after] - heights[after - 1]) * t,
  );
}

/** The app's colours and fonts a page can use, by the name it reads them as. */
export const RENDER_THEME_VARS = [
  "--text",
  "--muted",
  "--surface",
  "--background",
  "--border",
  "--hover",
  "--accent",
  "--accent-soft",
  "--accent-foreground",
  "--danger",
  "--code-background",
  "--code-foreground",
  "--font-sans",
  "--font-mono",
] as const;
/** Chart colours that read on both themes, as --series-1 … --series-6. */
const SERIES = {
  light: ["#6565a9", "#2f9e8f", "#d9822b", "#c2577a", "#4a8fd4", "#8a9a3a"],
  dark: ["#a3a3e6", "#5cc9b8", "#f0a65a", "#e486a6", "#7fb5ec", "#b6c46a"],
};

export interface RenderTheme {
  scheme: "light" | "dark";
  vars: Record<string, string>;
}
/** The default light theme, for looking at a page away from the window. */
export const LIGHT_RENDER_THEME: RenderTheme = {
  scheme: "light",
  vars: {
    "--text": "#303237",
    "--muted": "#898b93",
    "--surface": "#fff",
    "--background": "#fff",
    "--border": "#e2e3e6",
    "--hover": "#e5e5e9",
    "--accent": "#6565a9",
    "--accent-soft": "#eeeef7",
    "--accent-foreground": "#fff",
    "--danger": "#e46b73",
    "--code-background": "#fff",
    "--code-foreground": "#33353d",
    "--font-sans":
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    "--font-mono": 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  },
};
export const withSeries = (theme: RenderTheme): RenderTheme => ({
  ...theme,
  vars: {
    ...theme.vars,
    ...Object.fromEntries(
      SERIES[theme.scheme].map((c, i) => [`--series-${i + 1}`, c]),
    ),
  },
});

/** Messages between a page and the thread showing it. */
export type RenderToFrame =
  | ({ relayRender: "theme" } & RenderTheme)
  | { relayRender: "pause"; paused: boolean };
export type RenderFromFrame =
  | { relayRender: "size"; height: number }
  | { relayRender: "link"; href: string }
  | { relayRender: "compose"; text: string }
  /** Esc or a zoom key pressed in the page that the page left alone. */
  | { relayRender: "key"; key: string };

/** What the page's response allows: its own inline code and public https assets, no Relay origin. */
export const RENDER_CSP = [
  "sandbox allow-scripts allow-forms",
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "media-src data: blob: https:",
  "connect-src https:",
  "worker-src blob:",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

// Runs first in every page: the theme (from the URL's fragment, then live),
// the height the frame needs, links out through Relay, relay.compose(), and
// a pause for loops while the frame is out of sight or the window unfocused.
const BOOTSTRAP = `(() => {
  const root = document.documentElement;
  const post = (m) => parent.postMessage(m, "*");
  const style = document.createElement("style");
  style.textContent = ":root{color-scheme:light dark;font-family:var(--font-sans,system-ui,sans-serif);font-size:13px;color:var(--text,CanvasText)}body{margin:0;background:transparent}html[data-relay-paused] *,html[data-relay-paused] *::before,html[data-relay-paused] *::after{animation-play-state:paused!important}";
  (document.head || root).prepend(style);
  const theme = (t) => {
    if (!t || typeof t.vars !== "object") return;
    for (const [k, v] of Object.entries(t.vars))
      if (k.startsWith("--") && typeof v === "string") root.style.setProperty(k, v);
    root.style.colorScheme = t.scheme === "dark" ? "dark" : "light";
    root.dataset.theme = t.scheme === "dark" ? "dark" : "light";
  };
  try {
    const m = /[#&]theme=([^&]*)/.exec(location.hash);
    if (m) theme(JSON.parse(decodeURIComponent(m[1])));
  } catch {}
  let paused = false, queued = [];
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => paused ? -queued.push(cb) : raf(cb);
  window.cancelAnimationFrame = (id) => id < 0 ? (queued[-id - 1] = null) : caf(id);
  const pause = (on) => {
    paused = on;
    root.toggleAttribute("data-relay-paused", on);
    for (const media of document.querySelectorAll("video,audio")) if (on) media.pause();
    if (on) return;
    const waiting = queued; queued = [];
    for (const cb of waiting) if (cb) raf(cb);
  };
  addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || typeof e.data !== "object") return;
    if (e.data.relayRender === "theme") theme(e.data);
    else if (e.data.relayRender === "pause") pause(!!e.data.paused);
  });
  let last = 0;
  const size = () => {
    const h = Math.ceil(root.getBoundingClientRect().height);
    if (h !== last) post({ relayRender: "size", height: (last = h) });
  };
  new ResizeObserver(size).observe(root);
  addEventListener("load", size);
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element && e.target.closest("a[href]");
    if (!a || (a.getAttribute("href") || "").startsWith("#")) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(a.href)) post({ relayRender: "link", href: a.href });
  }, true);
  window.relay = { compose: (text) => post({ relayRender: "compose", text: String(text).slice(0, ${RENDER_COMPOSE_CHARS}) }) };
  // Focus in the page keeps keys from the thread, so Esc and the zoom keys go
  // up unless typed into a field or taken by the page, which it shows by
  // preventing their default once every listener has run.
  addEventListener("keydown", (e) => {
    if (!["Escape", "+", "=", "-", "0"].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const field = e.target instanceof Element && e.target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])");
    if (field && e.key !== "Escape") return;
    setTimeout(() => { if (!e.defaultPrevented) post({ relayRender: "key", key: e.key }); });
  });
})();`;

/** `html` with the bootstrap as the first thing in its head. */
export const injectRenderBootstrap = (html: string) =>
  prependToHead(html, `<script>${BOOTSTRAP}</script>`);

/** `html` with `tag` as the first thing in its head, adding a head when it has none. */
export function prependToHead(html: string, tag: string) {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return `${html.slice(0, at)}<head><meta charset="utf-8">${tag}</head>${html.slice(at)}`;
}

/** The line a thread's agent gets in its instructions where it has Relay's tools. */
export const RENDER_PROMPT =
  "When a chart, table, diagram, comparison or mockup would say more than prose, or the user wants to see a few ways to do something, show it in your answer with Relay's show_html tool (variants for alternatives) rather than describing it, and check a page with scripts with preview_html first. A whole app, or a page that needs a dev server, belongs in the thread's preview instead.";

/**
 * When agents show pages: on their own judgement, only when the user asks
 * for something to see, or never, without the tools. Pages cost tokens.
 */
export const renderModes = ["auto", "asked", "off"] as const;
export type RenderMode = (typeof renderModes)[number];

/** The line that replaces RENDER_PROMPT when pages are only for asking. */
export const RENDER_ASKED_PROMPT =
  "Use Relay's show_html tool only when the user asks to see something, like a chart, a table or a few versions to pick from; otherwise answer in text.";

/** The line about pages a thread's agent gets in its instructions, if any. */
export const renderPrompt = (mode: RenderMode = "auto") =>
  mode === "auto" ? RENDER_PROMPT : mode === "asked" ? RENDER_ASKED_PROMPT : "";

/** How a page should be built, for the agent; the tools' descriptions carry it. */
export const RENDER_GUIDE = `The page sits in the chat column between your tool calls and your reply, about 600 to 1100 px wide, its height fitted to its content (${RENDER_MAX_HEIGHT} px at most, then it scrolls). Build it to sit flush in the conversation:
- No outer background, card, border or big padding: the page's background shows the thread behind it. Let width be fluid, never fixed wider than 320 px.
- Use the app's theme through CSS variables, which follow light and dark: var(--text), var(--muted), var(--surface), var(--background), var(--border), var(--hover), var(--accent), var(--accent-soft), var(--danger), var(--code-background), var(--font-sans), var(--font-mono), and --series-1 … --series-6 for chart series. :root[data-theme="dark"] matches the dark theme.
- Give charts and canvases a fixed height (like 280px); never 100vh or height:100% on html/body, which leave the frame no content height to fit.
- Self-contained: inline CSS, JS and data. Libraries may load from https CDNs (like https://cdn.jsdelivr.net/npm/chart.js); local files and Relay can't be reached. Links open in the user's browser.
- window.relay.compose(text) puts text in the user's message box, for pages that let them pick or adjust something.
For a whole app or a page that needs a dev server, use a preview page instead.`;
