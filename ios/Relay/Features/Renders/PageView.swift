import RelayRemote
import SwiftUI
import WebKit

/// The phone's colours as a page reads them: the desktop's CSS variable names.
func renderTheme(_ c: RelayColors) -> RenderTheme {
    RenderTheme(
        dark: c.dark,
        vars: [
            "--text": css(c.foreground), "--muted": css(c.muted), "--surface": css(c.background),
            "--background": css(c.background), "--border": css(c.border), "--hover": css(c.fill),
            "--accent": css(c.accent), "--accent-soft": css(c.accentSoft), "--accent-foreground": css(c.onAccent),
            "--danger": css(c.destructive), "--code-background": css(c.code), "--code-foreground": css(c.foreground),
            "--font-sans": "system-ui, sans-serif",
            "--font-mono": "\"JetBrains Mono\", ui-monospace, Menlo, monospace",
        ])
}

private func css(_ color: Color) -> String {
    let c = UIColor(color).resolvedColor(with: .current)
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    c.getRed(&r, green: &g, blue: &b, alpha: &a)
    let hex = { (v: CGFloat) in String(format: "%02x", Int((min(max(v, 0), 1) * 255).rounded())) }
    return "#" + hex(r) + hex(g) + hex(b) + (a < 1 ? hex(a) : "")
}

/// A web view for a page from an agent (`phoneRenderDocument` makes the document) with
/// nothing to reach: no navigation, no storage, no files. `zoom` lets it pinch to zoom
/// and scroll, for a page at its real size; `scrolls` lets a page past the cap scroll itself.
struct PageView: UIViewRepresentable {
    let page: String
    var zoom = false
    var scrolls = false
    let onMessage: (RenderMessage) -> Void
    var onFailed: () -> Void = {}
    var onLoaded: () -> Void = {}

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.dataDetectorTypes = []
        config.mediaTypesRequiringUserActionForPlayback = .all
        let content = WKUserContentController()
        // The bootstrap posts through React Native's name, as on Android.
        content.addUserScript(
            WKUserScript(
                source: "window.\(renderBridge) = { postMessage: (m) => window.webkit.messageHandlers.relay.postMessage(String(m)) };",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(WeakHandler(context.coordinator), name: "relay")
        config.userContentController = content
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        web.navigationDelegate = context.coordinator
        context.coordinator.parent = self
        load(web, context.coordinator)
        apply(web)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.page != page { load(web, context.coordinator) }
        apply(web)
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "relay")
        web.stopLoading()
    }

    private func load(_ web: WKWebView, _ coordinator: Coordinator) {
        coordinator.page = page
        coordinator.loading = true
        web.loadHTMLString(page, baseURL: nil)
    }

    private func apply(_ web: WKWebView) {
        // A page that fits leaves the drag to the thread.
        web.scrollView.isScrollEnabled = zoom || scrolls
        web.scrollView.bounces = zoom
        web.scrollView.showsVerticalScrollIndicator = zoom || scrolls
        web.scrollView.showsHorizontalScrollIndicator = zoom
        if scrolls { web.evaluateJavaScript("document.documentElement.style.overflow='auto'") }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: PageView?
        var page: String?
        /// The document's own load, the one navigation a page gets.
        var loading = false

        func webView(
            _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
        ) {
            // Every other navigation is refused; links come through the page's click handler.
            let own = loading && action.navigationType == .other && action.request.url?.absoluteString == "about:blank"
            decisionHandler(own ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loading = false
            parent?.onLoaded()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent?.onFailed()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent?.onFailed()
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { parent?.onFailed() }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? String, let parsed = parseRenderMessage(body) else { return }
            parent?.onMessage(parsed)
        }
    }
}

/// The content controller holds its handlers strongly; this keeps it from holding the page.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
