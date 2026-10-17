import Foundation

// Android's HtmlRender.kt, a port of the parts of shared/html-render.ts and
// shared/html-render-phone.ts a phone uses: the sizes, the theme a page reads,
// the document a web view loads and the messages a page may send back.

public let renderWidths: [Double] = [320, 480, 640, 800, 960, 1120]
public let renderMinHeight = 80
public let renderMaxHeight = 2000

/// What a page may put in the composer through relay.compose().
public let renderComposeChars = 4000

/// The most an ask_html page may hand back through relay.answer(), as JSON.
public let askAnswerMaxChars = 32_000

/// The smallest a page is scaled to; wider than this and its edge is cut.
public let phoneMinScale = 0.5

public func clampRenderHeight(_ height: Double) -> Int {
    min(max(Int(height.rounded(.up)), renderMinHeight), renderMaxHeight)
}

/// The height a page needs at `width`, from its measured heights; nil when unmeasured.
public func renderHeightAt(_ heights: [Double]?, width: Double) -> Int? {
    guard let heights, heights.count == renderWidths.count else { return nil }
    guard let after = renderWidths.firstIndex(where: { $0 >= width }) else { return clampRenderHeight(heights.last!) }
    if after == 0 { return clampRenderHeight(heights[0]) }
    let from = renderWidths[after - 1], to = renderWidths[after]
    let t = (width - from) / (to - from)
    return clampRenderHeight(heights[after - 1] + (heights[after] - heights[after - 1]) * t)
}

/// The draft once a page composed `text`: in place of what the page composed
/// before while the draft still holds it, else after whatever is typed.
public func composeInto(_ draft: String, _ text: String, earlier: String? = nil) -> String {
    if let earlier, !earlier.isEmpty, let at = draft.range(of: earlier, options: .backwards) {
        return draft.replacingCharacters(in: at, with: text)
    }
    let kept = draft.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
    return kept.isEmpty ? text : "\(kept)\n\n\(text)"
}

public struct RenderTheme: Sendable, Equatable {
    public var dark: Bool
    public var vars: [String: String]

    public init(dark: Bool, vars: [String: String]) {
        self.dark = dark
        self.vars = vars
    }

    var scheme: String { dark ? "dark" : "light" }
}

/// Chart colours that read on both themes, as --series-1 … --series-6.
private let seriesLight = ["#6565a9", "#2f9e8f", "#d9822b", "#c2577a", "#4a8fd4", "#8a9a3a"]
private let seriesDark = ["#a3a3e6", "#5cc9b8", "#f0a65a", "#e486a6", "#7fb5ec", "#b6c46a"]

func withSeries(_ theme: RenderTheme) -> RenderTheme {
    var out = theme
    for (i, color) in (theme.dark ? seriesDark : seriesLight).enumerated() { out.vars["--series-\(i + 1)"] = color }
    return out
}

/// The desktop's rules without `sandbox`, which a <meta> can't carry.
public let phoneRenderCSP = [
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
].joined(separator: "; ")

/// What the bootstrap posts through, as React Native's web view named it; the app
/// defines it before the page runs.
public let renderBridge = "ReactNativeWebView"

private func bootstrap(_ theme: RenderTheme, fit: Bool) -> String {
    let t = withSeries(theme)
    // In a fixed order: a dictionary's isn't, and a document that differs reloads its page.
    let vars = t.vars.sorted { $0.key < $1.key }.map { JSON.string($0.key).text() + ":" + JSON.string($0.value).text() }
    let json = "{\"scheme\":\(JSON.string(t.scheme).text()),\"vars\":{\(vars.joined(separator: ","))}}"
        .replacingOccurrences(of: "<", with: "\\u003c")
    // Fitted into the thread, a page shrinks to the phone's width and says how tall it is;
    // at its real size it scrolls and zooms by itself.
    let fitRules =
        fit ? "html{overflow:hidden}html[data-relay-fit] body{width:var(--relay-w);transform:scale(var(--relay-s));transform-origin:0 0}" : ""
    let sizing =
        !fit
        ? ""
        : """

          let last = 0, queued = 0;
          const measure = () => {
            queued = 0;
            root.removeAttribute("data-relay-fit");
            const avail = root.clientWidth;
            const need = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
            let height;
            if (avail > 0 && need > avail + 1) {
              const width = Math.min(need, avail / \(phoneMinScale));
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
        """
    return """
        (() => {
          const root = document.documentElement;
          const post = (m) => window.\(renderBridge).postMessage(JSON.stringify(m));
          const style = document.createElement("style");
          style.textContent = ":root{color-scheme:light dark;font-family:var(--font-sans,system-ui,sans-serif);font-size:14px;color:var(--text,CanvasText)}html,body{margin:0;background:transparent}\(fitRules)";
          (document.head || root).prepend(style);
          const t = \(json);
          for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
          root.style.colorScheme = t.scheme;
          root.dataset.theme = t.scheme;\(sizing)
          document.addEventListener("click", (e) => {
            const a = e.target instanceof Element && e.target.closest("a[href]");
            if (!a || (a.getAttribute("href") || "").startsWith("#")) return;
            e.preventDefault();
            if (/^(https?|mailto):/i.test(a.href)) post({ relayRender: "link", href: a.href });
          }, true);
          window.relay = {
            compose: (text) => post({ relayRender: "compose", text: String(text).slice(0, \(renderComposeChars)) }),
            answer: (value) => { let json; try { json = JSON.stringify(value === undefined ? null : value); } catch { return; } post({ relayRender: "answer", json }); },
          };
        })();
        """
}

private let attributes = #"(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*/?"#

/// What may come before the head and load nothing: the doctype, comments and the `<html>` tag.
private let beforeHead = try! NSRegularExpression(
    pattern: #"^(?:\s+|<!--(?:-?>|[\s\S]*?--!?>)|<!doctype[^>]*>|<html"# + attributes + ">)*",
    options: [.caseInsensitive])
private let head = try! NSRegularExpression(pattern: "^<head" + attributes + ">", options: [.caseInsensitive])
private let doctype = try! NSRegularExpression(pattern: #"^\s*<!doctype"#, options: [.caseInsensitive])

private func prefix(_ regex: NSRegularExpression, _ text: String) -> Int? {
    regex.firstMatch(in: text, options: .anchored, range: NSRange(text.startIndex..., in: text)).map { $0.range.length }
}

/// `html` with `tag` as the first thing in its head, adding a head when it has none.
public func prependToHead(_ html: String, _ tag: String) -> String {
    let utf16 = html.utf16
    let at = utf16.index(utf16.startIndex, offsetBy: prefix(beforeHead, html) ?? 0)
    let rest = String(html[at...])
    if let length = prefix(head, rest) {
        let end = utf16.index(at, offsetBy: length)
        return String(html[..<end]) + tag + String(html[end...])
    }
    return "\(html[..<at])<head><meta charset=\"utf-8\">\(tag)</head>\(rest)"
}

/// `html` with the rules and the bootstrap first in its head; a doctype keeps it out of quirks mode.
/// `fit` shrinks it into a frame in the thread; without, it opens at its real size and pinches to zoom.
public func phoneRenderDocument(_ html: String, theme: RenderTheme, fit: Bool = true) -> String {
    let scale = fit ? "minimum-scale=1,maximum-scale=1" : "minimum-scale=0.25,maximum-scale=5"
    return prependToHead(
        prefix(doctype, html) != nil ? html : "<!doctype html>\(html)",
        // Without a viewport a web view lays a page out at about 980px.
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,\(scale)\">"
            + "<meta http-equiv=\"Content-Security-Policy\" content=\"\(phoneRenderCSP)\">"
            + "<script>\(bootstrap(theme, fit: fit))</script>")
}

/// What a page said: only the four messages Relay speaks pass, cut to what they may carry.
public enum RenderMessage: Sendable, Equatable {
    case size(Int)
    case link(String)
    case compose(String)
    case answer(String)
}

public func parseRenderMessage(_ data: String) -> RenderMessage? {
    guard let message = (try? JSON.parse(data))?.object else { return nil }
    switch message["relayRender"]?.string {
    case "size":
        // A formula is one line tall: the desktop's minimum frame would triple it.
        guard let height = message["height"]?.number, height.isFinite else { return nil }
        return .size(Int(min(max(height.rounded(.up), 1), Double(renderMaxHeight))))
    case "link":
        guard let href = message["href"]?.string, href.range(of: "^(https?|mailto):", options: [.regularExpression, .caseInsensitive]) != nil
        else { return nil }
        return .link(String(href.prefix(2000)))
    case "compose":
        guard let text = message["text"]?.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return .compose(String(text.prefix(renderComposeChars)))
    case "answer":
        // Too big to hand back is no answer at all, rather than a cut one.
        guard let json = message["json"]?.string, json.utf16.count <= askAnswerMaxChars else { return nil }
        return .answer(json)
    default:
        return nil
    }
}

extension RemoteClient {
    /// A show_html or ask_html page's HTML. From bridge 17.
    public func renderPage(chatId: String, renderId: String, page: Int) async throws -> String {
        guard let html = try await call("renderPage", [.string(chatId), .string(renderId), .number(Double(page))]).string
        else { throw RemoteCallError.rejected("That page isn't there any more.") }
        return html
    }
}
