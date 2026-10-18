import RelayRemote
import SwiftUI
import WebKit

/// A browser on the computer's localhost, through the bridge: the address bar shows the
/// computer's own address, the page loads from the phone's listener for that port. With no
/// page yet, or while the address is edited, it lists what runs there.
struct BrowserView: View {
    var url: String?
    @Environment(Connection.self) private var connection

    var body: some View {
        // Pages, their storage and the ports they may open are one computer's; another starts over.
        ComputerBrowser(url: url, computer: connection.active ?? "")
            .id(connection.active)
    }
}

private struct ComputerBrowser: View {
    let computer: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    /// The computer's address of the page.
    @State private var href: String?
    /// What the page should load; a link's address waits until its port is allowed.
    @State private var wanted: SiteAddress?
    @State private var loads = 0
    @State private var text: String
    @State private var editing: Bool
    @State private var page: BrowserPage?
    /// A link to a port that's neither a site nor typed, waiting for a yes.
    @State private var asking: SiteAddress?
    @State private var release: (@Sendable () -> Void)?
    @FocusState private var typing: Bool

    init(url: String?, computer: String) {
        self.computer = computer
        let address = url.flatMap(LocalUrls.link)
        _href = State(initialValue: address?.href)
        _text = State(initialValue: address?.shown ?? "")
        _editing = State(initialValue: address == nil)
    }

    private var current: SiteAddress? { href.flatMap(LocalUrls.link) }
    private var name: String { connection.overview?.name ?? "your computer" }
    private var online: Bool { connection.status.state == .online }
    private var ports: TunnelPorts { connection.tunnelPorts }

    var body: some View {
        ZStack {
            if !connection.canTunnel && connection.overview != nil {
                ContentUnavailableView(
                    "Update Relay on \(name)", systemImage: "network.slash",
                    description: Text("Opening its localhost here needs a newer Relay there."))
            } else {
                if current != nil, let page {
                    WebViewHost(web: page.web).ignoresSafeArea(edges: .bottom)
                    if let failed = page.failed, let current {
                        ContentUnavailableView {
                            Label("Couldn't load \(current.shown)", systemImage: "exclamationmark.triangle")
                        } description: {
                            Text(online ? failed : "Not connected to \(name).")
                        } actions: {
                            Button("Try again") { open(current) }
                        }
                        .background(colors.background)
                    }
                }
                if let asking {
                    ContentUnavailableView {
                        Label("\(asking.shown) isn't one of your sites", systemImage: "questionmark.circle")
                    } description: {
                        Text(
                            "The phone only opens ports Sites lists or ones you type here, so a link can't reach everything else running on \(name)."
                        )
                    } actions: {
                        Button("Open it") { open(asking, typed: true) }
                    }
                    .background(colors.background)
                } else if editing || current == nil {
                    SitesList(name: name, typed: text) { open($0) }
                }
            }
        }
        .overlay(alignment: .top) {
            if let page, page.loading, !editing {
                ProgressView(value: page.progress).tint(colors.accent).scaleEffect(y: 0.6, anchor: .top)
            }
        }
        .safeAreaBar(edge: .bottom) { addressBar }
        .relayBackground()
        .navigationTitle(editing || current == nil ? "Sites" : page?.title.flatMap { $0.isEmpty ? nil : $0 } ?? current?.shown ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: typing) { if typing { editing = true } }
        .onChange(of: page?.url) {
            guard let url = page?.url, let at = LocalUrls.desktop(url.absoluteString, desktopPortOf: connection.tunnels.desktopPort)
            else { return }
            href = at.href
            if !editing { text = at.shown }
        }
        .onChange(of: online) {
            // Every stream ended with the link; what was on screen came back as "Not connected".
            guard online, let back = wanted else { return }
            Task {
                await allowTyped(back.port)
                page?.failed = nil
                page?.web.reload()
            }
        }
        .task(id: loads) { await load() }
        .onAppear {
            // Connections reach the computer only while a browser is open.
            if release == nil { release = connection.tunnels.hold() }
            let paired = Set(connection.computers.map(\.key))
            // Not before the pairings are read: an empty list would wipe every computer's.
            if paired.contains(computer) {
                ports.keepOnly(paired)
                BrowserStores.keepOnly(paired)
            }
            if wanted == nil, let current { open(current) }
        }
        .onDisappear {
            release?()
            release = nil
        }
    }

    private var addressBar: some View {
        GlassEffectContainer {
            HStack(spacing: 8) {
                let browsing = !editing && current != nil
                if browsing {
                    Button("Back", systemImage: "chevron.backward") { page?.web.goBack() }
                        .disabled(page?.canBack != true)
                    Button("Forward", systemImage: "chevron.forward") { page?.web.goForward() }
                        .disabled(page?.canForward != true)
                }
                TextField("localhost:port", text: $text)
                    .font(.mono(.body))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($typing)
                    .onSubmit { if let address = LocalUrls.typed(text) { open(address, typed: true) } }
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .glassEffect(.regular.interactive(), in: .capsule)
                if browsing {
                    Button("Reload", systemImage: "arrow.clockwise", action: reload)
                } else if editing, let current {
                    Button("Cancel", systemImage: "xmark") {
                        editing = false
                        typing = false
                        text = current.shown
                    }
                }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(.large)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    private func reload() {
        guard let page, let current else { return }
        if page.web.url == nil || page.failed != nil { open(current) } else { page.web.reload() }
    }

    private func go(_ address: SiteAddress) {
        asking = nil
        wanted = address
        href = address.href
        text = address.shown
        editing = false
        typing = false
        page?.failed = nil
        loads += 1
    }

    /// Opens `address` if Sites lists its port or it was typed; `typed` says this one is.
    private func open(_ address: SiteAddress, typed: Bool = false) {
        if typed { ports.type(address.port, on: computer) }
        if ports.allows(address.port, on: computer) { return go(address) }
        typing = false
        Task {
            // Sites may not have been asked yet in this run.
            _ = try? await connection.sites()
            if ports.allows(address.port, on: computer) { go(address) } else { asking = address }
        }
    }

    /// The computer lets the tunnel reach a typed port once it's told, and forgets on restart:
    /// tells it `port` before the page loads, and beside that every other typed port a page
    /// here may call, the ones the phone listens for.
    private func allowTyped(_ port: Int) async {
        let computer = computer
        let allow = { (p: Int) async in
            if ports.isTyped(p, on: computer), connection.active == computer { try? await connection.tunnelAllow(p) }
        }
        for p in connection.tunnels.listening().subtracting([port]) { Task { await allow(p) } }
        await allow(port)
    }

    private func load() async {
        let page = page ?? made()
        guard let address = wanted else { return }
        await allowTyped(address.port)
        do {
            let local = try await connection.tunnels.listen(address.port)
            guard let url = URL(string: LocalUrls.local(address, localPort: local)) else { return }
            page.load(url)
        } catch {
            page.failed = "The phone couldn't listen for localhost:\(address.port): \(error.localizedDescription)"
        }
    }

    private func made() -> BrowserPage {
        let made = BrowserPage(computer: computer, tunnels: connection.tunnels)
        made.onOpen = { open($0) }
        page = made
        return made
    }
}

/// The browser's one web view, kept across the screen redrawing.
private struct WebViewHost: UIViewRepresentable {
    let web: WKWebView

    func makeUIView(context: Context) -> WKWebView { web }
    func updateUIView(_ web: WKWebView, context: Context) {}
}
