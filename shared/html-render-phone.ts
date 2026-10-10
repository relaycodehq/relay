// The pages an answer shows with show_html, as a phone's WebView draws them.
// The desktop frames a page at 600 to 1100 px; a phone is about 360, so a page
// that comes out wider than the screen is laid out at the width it needs and
// scaled down to fit, rather than scrolled sideways.
import {
  ASK_ANSWER_MAX_CHARS,
  RENDER_MAX_HEIGHT,
  RENDER_COMPOSE_CHARS,
  RENDER_CSP,
  prependToHead,
  withSeries,
  type RenderFromFrame,
  type RenderTheme,
} from "./html-render";

/** The smallest a page is scaled to; wider than this and its edge is cut. */
export const PHONE_MIN_SCALE = 0.5;

/** The desktop's rules without `sandbox`, which a <meta> can't carry: the WebView's navigation lock and missing origin stand in. */
export const PHONE_RENDER_CSP = RENDER_CSP.split("; ")
  .filter((directive) => !directive.startsWith("sandbox"))
  .join("; ");

// Runs first in every page, like the desktop's bootstrap (shared/html-render)
// but talking to React Native: the theme comes inline, the height and the
// scale go out as messages, links and relay.compose() are messages too.
const bootstrap = (theme: RenderTheme) => `(() => {
  const root = document.documentElement;
  const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const style = document.createElement("style");
  style.textContent = ":root{color-scheme:light dark;font-family:var(--font-sans,system-ui,sans-serif);font-size:14px;color:var(--text,CanvasText)}html,body{margin:0;background:transparent}html{overflow:hidden}html[data-relay-fit] body{width:var(--relay-w);transform:scale(var(--relay-s));transform-origin:0 0}";
  (document.head || root).prepend(style);
  const t = ${JSON.stringify(withSeries(theme)).replace(/</g, "\\u003c")};
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.style.colorScheme = t.scheme;
  root.dataset.theme = t.scheme;
  let last = 0, queued = 0;
  const measure = () => {
    queued = 0;
    root.removeAttribute("data-relay-fit");
    const avail = root.clientWidth;
    const need = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
    let height;
    if (avail > 0 && need > avail + 1) {
      const width = Math.min(need, avail / ${PHONE_MIN_SCALE});
      const scale = avail / width;
      root.style.setProperty("--relay-w", width + "px");
      root.style.setProperty("--relay-s", String(scale));
      root.setAttribute("data-relay-fit", "");
      height = Math.ceil(root.getBoundingClientRect().height * scale);
    } else height = Math.ceil(root.getBoundingClientRect().height);
    if (height !== last) post({ relayRender: "size", height: (last = height) });
  };
  const schedule = () => { if (!queued) queued = requestAnimationFrame(measure); };
  new ResizeObserver(schedule).observe(root);
  addEventListener("load", schedule);
  addEventListener("resize", schedule);
  if (document.fonts) document.fonts.ready.then(schedule);
  document.addEventListener("DOMContentLoaded", () => {
    if (document.body) new ResizeObserver(schedule).observe(document.body);
    schedule();
  });
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element && e.target.closest("a[href]");
    if (!a || (a.getAttribute("href") || "").startsWith("#")) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(a.href)) post({ relayRender: "link", href: a.href });
  }, true);
  window.relay = {
    compose: (text) => post({ relayRender: "compose", text: String(text).slice(0, ${RENDER_COMPOSE_CHARS}) }),
    answer: (value) => { let json; try { json = JSON.stringify(value === undefined ? null : value); } catch { return; } post({ relayRender: "answer", json }); },
  };
})();`;

/**
 * `html` with the rules and the bootstrap as the first things in its head.
 * Without a doctype the page would be in quirks mode, where its body stretches
 * to the whole frame and no content height can be read.
 */
export const phoneRenderDocument = (html: string, theme: RenderTheme) =>
  prependToHead(
    /^\s*<!doctype/i.test(html) ? html : `<!doctype html>${html}`,
    // Without a viewport an Android WebView lays a page out at about 980 px
    // and shrinks it to fit, so nothing would be as large as it should.
    `<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="${PHONE_RENDER_CSP}"><script>${bootstrap(theme)}</script>`,
  );

/**
 * What a page said, from the string the WebView hands over. A page is code from
 * an agent and can post anything, so only the three messages Relay speaks pass,
 * cut to what they may carry.
 */
export function parseRenderMessage(data: string): RenderFromFrame | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object") return null;
  const { relayRender, height, href, text, json } = message as Record<
    string,
    unknown
  >;
  if (
    relayRender === "size" &&
    typeof height === "number" &&
    Number.isFinite(height)
  )
    // A formula is one line tall: the desktop's minimum frame would triple it.
    return {
      relayRender,
      height: Math.min(RENDER_MAX_HEIGHT, Math.max(1, Math.ceil(height))),
    };
  if (
    relayRender === "link" &&
    typeof href === "string" &&
    /^(https?|mailto):/i.test(href)
  )
    return { relayRender, href: href.slice(0, 2000) };
  if (relayRender === "compose" && typeof text === "string" && text.trim())
    return { relayRender, text: text.slice(0, RENDER_COMPOSE_CHARS) };
  // Too big to hand back is no answer at all, rather than a cut one.
  if (
    relayRender === "answer" &&
    typeof json === "string" &&
    json.length <= ASK_ANSWER_MAX_CHARS
  )
    return { relayRender, json };
  return null;
}
