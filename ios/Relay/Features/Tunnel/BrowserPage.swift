import CryptoKit
import RelayRemote
import UIKit
import WebKit

/// The browser's web view and what the screen shows of it. It stays on the computer's
/// localhost: a link to another port there opens through its own listener (`onOpen`),
/// anything else in the phone's own browser or app for it.
@MainActor @Observable
final class BrowserPage: NSObject, WKNavigationDelegate, WKUIDelegate {
    @ObservationIgnored let web: WKWebView
    private(set) var loading = false
    private(set) var progress = 0.0
    private(set) var canBack = false
    private(set) var canForward = false
    private(set) var title: String?
    /// The phone's URL of the page; `BrowserView` maps it back to the computer's.
    private(set) var url: URL?
    var failed: String?
    @ObservationIgnored var onOpen: (SiteAddress) -> Void = { _ in }
    @ObservationIgnored private let tunnels: TunnelListeners
    @ObservationIgnored private var watching: [NSKeyValueObservation] = []

    init(computer: String, tunnels: TunnelListeners) {
        self.tunnels = tunnels
        let config = WKWebViewConfiguration()
        config.websiteDataStore = BrowserStores.store(for: computer)
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        web = WKWebView(frame: .zero, configuration: config)
        web.allowsBackForwardNavigationGestures = true
        super.init()
        web.navigationDelegate = self
        web.uiDelegate = self
        // WebKit reports these on the main thread.
        watching = [
            web.observe(\.isLoading) { [weak self] web, _ in MainActor.assumeIsolated { self?.loading = web.isLoading } },
            web.observe(\.estimatedProgress) { [weak self] web, _ in
                MainActor.assumeIsolated { self?.progress = web.estimatedProgress }
            },
            web.observe(\.canGoBack) { [weak self] web, _ in MainActor.assumeIsolated { self?.canBack = web.canGoBack } },
            web.observe(\.canGoForward) { [weak self] web, _ in MainActor.assumeIsolated { self?.canForward = web.canGoForward } },
            web.observe(\.title) { [weak self] web, _ in MainActor.assumeIsolated { self?.title = web.title } },
            web.observe(\.url) { [weak self] web, _ in MainActor.assumeIsolated { self?.url = web.url } },
        ]
    }

    func load(_ url: URL) {
        failed = nil
        web.load(URLRequest(url: url))
    }

    /// Where `url` goes: through its listener, to the browser's Open, or out of the app.
    private func route(_ url: URL) -> WKNavigationActionPolicy {
        let target = url.absoluteString
        if LocalUrls.desktop(target, desktopPortOf: tunnels.desktopPort) != nil { return .allow }
        if let address = LocalUrls.link(target) {
            onOpen(address)
        } else if ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        return .cancel
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        // A frame inside the page loads what the page says.
        if action.targetFrame?.isMainFrame == false { return .allow }
        return route(url)
    }

    /// A link to a new window opens in this one.
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url, route(url) == .allow { webView.load(action.request) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        failed = "The page stopped: it crashed, or iOS closed it to free memory."
    }

    private func fail(_ error: Error) {
        let e = error as NSError
        // Cut short by the next load or by a link Relay opened itself.
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        failed = e.localizedDescription
    }
}

/// Every computer's pages load as http://localhost:<port>, so on one shared store a page from
/// one computer would find another's cookies (which ignore the port), storage and service
/// workers: each computer gets a store of its own.
@MainActor
enum BrowserStores {
    static func store(for computer: String) -> WKWebsiteDataStore {
        WKWebsiteDataStore(forIdentifier: id(computer))
    }

    /// Deletes what computers no longer paired left behind.
    static func keepOnly(_ computers: Set<String>) {
        let kept = Set(computers.map(id))
        WKWebsiteDataStore.fetchAllDataStoreIdentifiers { ids in
            for gone in ids where !kept.contains(gone) {
                WKWebsiteDataStore.remove(forIdentifier: gone) { _ in }
            }
        }
    }

    /// The same computer gets the same store each time.
    private static func id(_ computer: String) -> UUID {
        var bytes = Array(SHA256.hash(data: Data(("relay-browser:" + computer).utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}
