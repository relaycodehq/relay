import RelayRemote
import SwiftUI

/// Puts a page's relay.compose() text in the composer, in place of `earlier`, what the page composed before.
typealias RenderCompose = (_ text: String, _ earlier: String?) -> Void

extension EnvironmentValues {
    /// Where a page's relay.compose() goes; nil where there's no composer to fill.
    @Entry var renderCompose: RenderCompose?
}

@MainActor
private enum RenderMemory {
    /// The height each page last settled at, so a row mounted again opens at it.
    static var settled: [String: Int] = [:]
    /// What each render last composed, so its next relay.compose() replaces it.
    static var composed: [String: String] = [:]
}

/// A saved page's HTML (nil while loading), and whether the desktop couldn't send it.
struct LoadedPage: Equatable {
    var html: String?
    var failed = false
}

/// Fetches a saved page once the computer is online; one fetched before is there at once.
struct PageLoader<Content: View>: View {
    let chatId: String
    let renderId: String
    let page: Int
    @ViewBuilder let content: (LoadedPage) -> Content
    @Environment(Connection.self) private var connection
    @State private var loaded = LoadedPage()

    var body: some View {
        let known = connection.knownPage(chatId, render: renderId, page: page)
        let online = connection.status.state == .online
        content(known.map { LoadedPage(html: $0) } ?? loaded)
            .task(id: "\(renderId):\(page):\(online)") {
                guard known == nil, online else { return }
                do {
                    loaded = LoadedPage(html: try await connection.renderPage(chatId, render: renderId, page: page))
                } catch is CancellationError {
                } catch {
                    loaded = LoadedPage(failed: true)
                }
            }
    }
}

/// Pages the agent showed with show_html, drawn under its message; an older desktop can't send them.
struct MessageRenders: View {
    let chatId: String
    let renders: [HtmlRender]
    @Environment(Connection.self) private var connection

    var body: some View {
        if !renders.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(renders) { render in
                    if connection.canRender {
                        RenderCard(chatId: chatId, render: render)
                    } else {
                        RenderNote(render: render, computer: connection.overview?.name ?? "the computer")
                    }
                }
            }
        }
    }
}

/// What shows when the desktop is too old to send its pages: where to see them.
private struct RenderNote: View {
    let render: HtmlRender
    let computer: String
    @Environment(\.colors) private var colors

    var body: some View {
        let variants = render.pages.compactMap { $0.label?.isEmpty == false ? $0.label : nil }
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "macwindow")
                .font(.footnote)
                .foregroundStyle(colors.muted)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(render.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(colors.foreground)
                    .lineLimit(2)
                Text(
                    (variants.count > 1 ? "\(variants.count) versions: \(variants.joined(separator: ", ")). " : "")
                        + "Open this thread on \(computer) to see \(variants.count > 1 ? "them" : "it")."
                )
                .font(.caption)
                .foregroundStyle(colors.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.card, in: .rect(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(colors.border))
    }
}

private struct RenderCard: View {
    let chatId: String
    let render: HtmlRender
    @State private var index = 0
    @State private var expanded = false
    @State private var width: Double?
    @Namespace private var transition
    @Environment(\.colors) private var colors
    @Environment(\.renderCompose) private var renderCompose

    /// The render's relay.compose(), replacing what it composed before while the draft still holds that.
    private var compose: ((String) -> Void)? {
        guard let renderCompose else { return nil }
        let from = "\(chatId):\(render.id)"
        return { text in
            renderCompose(text, RenderMemory.composed[from])
            RenderMemory.composed[from] = text
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Text(render.title)
                    .font(.caption)
                    .foregroundStyle(colors.muted)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if render.pages.count > 1 {
                    Variants(render: render, index: $index).font(.caption)
                }
                Button("Expand", systemImage: "arrow.up.left.and.arrow.down.right") { expanded = true }
                    .labelStyle(.iconOnly)
                    .font(.caption)
                    .foregroundStyle(colors.muted)
                    .buttonStyle(.plain)
                    .contentShape(.rect.inset(by: -8))
            }
            // Another variant is another page, not a redraw of this one.
            RenderPage(chatId: chatId, render: render, index: index, width: width, compose: compose)
                .id(index)
                .clipShape(.rect(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(colors.border))
                .matchedTransitionSource(id: render.id, in: transition)
                .onGeometryChange(for: Double.self, of: { $0.size.width }) { width = $0 }
        }
        .fullScreenCover(isPresented: $expanded) {
            RenderStage(chatId: chatId, render: render, index: $index, compose: compose)
                .navigationTransition(.zoom(sourceID: render.id, in: transition))
        }
    }
}

/// A render's variants as tabs, by their labels or numbered.
struct Variants: View {
    let render: HtmlRender
    @Binding var index: Int
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 14) {
            ForEach(Array(render.pages.enumerated()), id: \.offset) { i, page in
                let on = i == index
                Button(page.label?.isEmpty == false ? page.label! : "\(i + 1)") { index = i }
                    .fontWeight(on ? .semibold : .regular)
                    .foregroundStyle(on ? colors.foreground : colors.muted)
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .lineLimit(1)
    }
}

private struct RenderPage: View {
    let chatId: String
    let render: HtmlRender
    let index: Int
    let width: Double?
    let compose: ((String) -> Void)?
    @Environment(\.colors) private var colors

    var body: some View {
        // Until the frame is measured, a phone's width less the thread's margins.
        let width = Int(self.width ?? 360)
        let settledKey = "\(render.id):\(index):\(width)"
        let estimate =
            RenderMemory.settled[settledKey]
            ?? renderHeightAt(render.pages.indices.contains(index) ? render.pages[index].heights : nil, width: Double(width))
            ?? clampRenderHeight(Double(renderMinHeight * 2))
        PageLoader(chatId: chatId, renderId: render.id, page: index) { loaded in
            let note = Text(loaded.failed ? "This page couldn't be loaded." : "Loading page…")
                .font(.caption)
                .foregroundStyle(colors.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if let html = loaded.html {
                RenderFrame(
                    page: phoneRenderDocument(html, theme: renderTheme(colors)), height: estimate,
                    onCompose: compose, onSize: { RenderMemory.settled[settledKey] = $0 }
                ) { note }
            } else {
                note.frame(height: CGFloat(estimate))
            }
        }
    }
}

/// An agent's page fitted into the thread. It tells its height, which the frame takes;
/// `placeholder` keeps the place until it has drawn, and stands in if it can't. `share`
/// caps it at that part of the screen, the page scrolling inside.
struct RenderFrame<Placeholder: View>: View {
    let page: String
    let height: Int
    var share: CGFloat?
    var onCompose: ((String) -> Void)?
    var onAnswer: ((String) -> Void)?
    var onSize: ((Int) -> Void)?
    @ViewBuilder var placeholder: Placeholder
    @State private var measured: Int?
    @State private var failed = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        let shown = measured ?? height
        ZStack {
            if measured == nil || failed { placeholder }
            if !failed {
                // A capped page scrolls only once it's taller than its frame; until then the drag stays the thread's.
                PageView(page: page, scrolls: shown >= renderMaxHeight || share != nil, onMessage: handle) { failed = true }
                    .opacity(measured == nil ? 0 : 1)
            }
        }
        .frame(maxWidth: .infinity)
        .containerRelativeFrame(.vertical) { length, _ in
            share.map { min(CGFloat(shown), length * $0) } ?? CGFloat(shown)
        }
        .clipped()
        .onChange(of: page) {
            measured = nil
            failed = false
        }
    }

    private func handle(_ message: RenderMessage) {
        switch message {
        case .size(let height):
            measured = height
            onSize?(height)
        case .link(let href): if let url = URL(string: href) { openURL(url) }
        case .compose(let text): onCompose?(text)
        case .answer(let json): onAnswer?(json)
        }
    }
}

/// A show_html page over the whole screen, as the desktop's Expand: at its real size rather
/// than shrunk into the thread, scrolling itself and pinched to zoom. Switching variants here
/// switches the card's too.
private struct RenderStage: View {
    let chatId: String
    let render: HtmlRender
    @Binding var index: Int
    let compose: ((String) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @Environment(\.openURL) private var openURL
    @State private var failed = false
    @State private var drawn = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if render.pages.count > 1 {
                    ScrollView(.horizontal) {
                        Variants(render: render, index: $index)
                            .font(.subheadline)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                    }
                    .scrollIndicators(.hidden)
                }
                Divider()
                PageLoader(chatId: chatId, renderId: render.id, page: index) { loaded in
                    ZStack {
                        if loaded.html == nil || failed || !drawn {
                            Text(loaded.failed || failed ? "This page couldn't be loaded." : "Loading page…")
                                .foregroundStyle(colors.muted)
                        }
                        if let html = loaded.html, !failed {
                            PageView(
                                page: phoneRenderDocument(html, theme: renderTheme(colors), fit: false), zoom: true,
                                onMessage: {
                                    switch $0 {
                                    case .link(let href): if let url = URL(string: href) { openURL(url) }
                                    case .compose(let text): compose?(text)
                                    default: break
                                    }
                                }, onFailed: { failed = true }, onLoaded: { drawn = true }
                            )
                            // A transparent page would show the note through it until it has drawn.
                            .opacity(drawn ? 1 : 0)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .id(index)
                .onChange(of: index) {
                    failed = false
                    drawn = false
                }
            }
            .relayBackground()
            .navigationTitle(render.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
    }
}
