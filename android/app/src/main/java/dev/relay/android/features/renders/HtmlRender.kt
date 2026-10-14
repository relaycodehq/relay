package dev.relay.android.features.renders

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlin.math.ceil

// Port of the parts of shared/html-render.ts and shared/html-render-phone.ts a
// phone uses: the sizes, the theme a page reads, the document a WebView loads
// and the messages a page may send back.

val RENDER_WIDTHS = listOf(320, 480, 640, 800, 960, 1120)
const val RENDER_MIN_HEIGHT = 80
const val RENDER_MAX_HEIGHT = 2000

/** What a page may put in the composer through relay.compose(). */
const val RENDER_COMPOSE_CHARS = 4000

/** The most an ask_html page may hand back through relay.answer(), as JSON. */
const val ASK_ANSWER_MAX_CHARS = 32_000

/** The smallest a page is scaled to; wider than this and its edge is cut. */
const val PHONE_MIN_SCALE = 0.5

fun clampRenderHeight(height: Double): Int =
    ceil(height).toInt().coerceIn(RENDER_MIN_HEIGHT, RENDER_MAX_HEIGHT)

/** The height a page needs at `width`, from its measured heights; null when unmeasured. */
fun renderHeightAt(heights: List<Double>?, width: Double): Int? {
    if (heights == null || heights.size != RENDER_WIDTHS.size) return null
    val after = RENDER_WIDTHS.indexOfFirst { it >= width }
    if (after == 0) return clampRenderHeight(heights[0])
    if (after < 0) return clampRenderHeight(heights.last())
    val from = RENDER_WIDTHS[after - 1].toDouble()
    val to = RENDER_WIDTHS[after].toDouble()
    val t = (width - from) / (to - from)
    return clampRenderHeight(heights[after - 1] + (heights[after] - heights[after - 1]) * t)
}

/**
 * The draft once a page composed `text`: in place of what the page composed
 * before while the draft still holds it, else after whatever is typed.
 */
fun composeInto(draft: String, text: String, earlier: String? = null): String {
    val at = if (!earlier.isNullOrEmpty()) draft.lastIndexOf(earlier) else -1
    if (at >= 0) return draft.substring(0, at) + text + draft.substring(at + earlier!!.length)
    return if (draft.isNotBlank()) "${draft.trimEnd()}\n\n$text" else text
}

data class RenderTheme(val dark: Boolean, val vars: Map<String, String>) {
    val scheme get() = if (dark) "dark" else "light"
}

/** Chart colours that read on both themes, as --series-1 … --series-6. */
private val SERIES_LIGHT = listOf("#6565a9", "#2f9e8f", "#d9822b", "#c2577a", "#4a8fd4", "#8a9a3a")
private val SERIES_DARK = listOf("#a3a3e6", "#5cc9b8", "#f0a65a", "#e486a6", "#7fb5ec", "#b6c46a")

fun withSeries(theme: RenderTheme) = theme.copy(
    vars = theme.vars + (if (theme.dark) SERIES_DARK else SERIES_LIGHT)
        .mapIndexed { i, c -> "--series-${i + 1}" to c },
)

/** The desktop's rules without `sandbox`, which a <meta> can't carry. */
val PHONE_RENDER_CSP = listOf(
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
).joinToString("; ")

/** The name of the JavaScript interface the bootstrap posts through, as React Native's. */
const val RENDER_BRIDGE = "ReactNativeWebView"

private fun bootstrap(theme: RenderTheme): String {
    val t = withSeries(theme)
    val json = buildJsonObject {
        put("scheme", t.scheme)
        put("vars", JsonObject(t.vars.mapValues { JsonPrimitive(it.value) }))
    }.toString().replace("<", "\\u003c")
    return """(() => {
  const root = document.documentElement;
  const post = (m) => window.$RENDER_BRIDGE.postMessage(JSON.stringify(m));
  const style = document.createElement("style");
  style.textContent = ":root{color-scheme:light dark;font-family:var(--font-sans,system-ui,sans-serif);font-size:14px;color:var(--text,CanvasText)}html,body{margin:0;background:transparent}html{overflow:hidden}html[data-relay-fit] body{width:var(--relay-w);transform:scale(var(--relay-s));transform-origin:0 0}";
  (document.head || root).prepend(style);
  const t = $json;
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
      const width = Math.min(need, avail / $PHONE_MIN_SCALE);
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
    compose: (text) => post({ relayRender: "compose", text: String(text).slice(0, $RENDER_COMPOSE_CHARS) }),
    answer: (value) => { let json; try { json = JSON.stringify(value === undefined ? null : value); } catch { return; } post({ relayRender: "answer", json }); },
  };
})();"""
}

private const val ATTRIBUTES = """(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*/?"""

/** What may come before the head and load nothing: the doctype, comments and the `<html>` tag. */
private val BEFORE_HEAD = Regex(
    """^(?:\s+|<!--(?:-?>|[\s\S]*?--!?>)|<!doctype[^>]*>|<html$ATTRIBUTES>)*""",
    RegexOption.IGNORE_CASE,
)
private val HEAD = Regex("^<head$ATTRIBUTES>", RegexOption.IGNORE_CASE)

/** `html` with `tag` as the first thing in its head, adding a head when it has none. */
fun prependToHead(html: String, tag: String): String {
    val at = BEFORE_HEAD.find(html)?.value?.length ?: 0
    val head = HEAD.find(html.substring(at))
    if (head != null) {
        val end = at + head.value.length
        return html.substring(0, end) + tag + html.substring(end)
    }
    return "${html.substring(0, at)}<head><meta charset=\"utf-8\">$tag</head>${html.substring(at)}"
}

private val DOCTYPE = Regex("^\\s*<!doctype", RegexOption.IGNORE_CASE)

/** `html` with the rules and the bootstrap first in its head; a doctype keeps it out of quirks mode. */
fun phoneRenderDocument(html: String, theme: RenderTheme): String = prependToHead(
    if (DOCTYPE.containsMatchIn(html)) html else "<!doctype html>$html",
    // Without a viewport an Android WebView lays a page out at about 980 px.
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1\">" +
        "<meta http-equiv=\"Content-Security-Policy\" content=\"$PHONE_RENDER_CSP\">" +
        "<script>${bootstrap(theme)}</script>",
)

/** What a page said: only the four messages Relay speaks pass, cut to what they may carry. */
sealed interface RenderMessage {
    data class Size(val height: Int) : RenderMessage
    data class Link(val href: String) : RenderMessage
    data class Compose(val text: String) : RenderMessage
    data class Answer(val json: String) : RenderMessage
}

private val WEB_OR_MAIL = Regex("^(https?|mailto):", RegexOption.IGNORE_CASE)

fun parseRenderMessage(data: String): RenderMessage? {
    val message = try {
        Json.parseToJsonElement(data) as? JsonObject
    } catch (_: Exception) {
        null
    } ?: return null
    fun string(key: String) = (message[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    return when (string("relayRender")) {
        "size" -> (message["height"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
            ?.takeIf { it.isFinite() }
            // A formula is one line tall: the desktop's minimum frame would triple it.
            ?.let { RenderMessage.Size(ceil(it).coerceIn(1.0, RENDER_MAX_HEIGHT.toDouble()).toInt()) }
        "link" -> string("href")?.takeIf { WEB_OR_MAIL.containsMatchIn(it) }?.let { RenderMessage.Link(it.take(2000)) }
        "compose" -> string("text")?.takeIf { it.isNotBlank() }?.let { RenderMessage.Compose(it.take(RENDER_COMPOSE_CHARS)) }
        // Too big to hand back is no answer at all, rather than a cut one.
        "answer" -> string("json")?.takeIf { it.length <= ASK_ANSWER_MAX_CHARS }?.let { RenderMessage.Answer(it) }
        else -> null
    }
}
