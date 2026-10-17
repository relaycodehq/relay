import RelayRemote
import SwiftUI

/// A page Relay couldn't measure opens at this height, then fits itself.
private let unmeasuredHeight = 240

/// The page an agent asks with (ask_html): the same page the desktop shows. It hands over
/// its answer with relay.answer() as the user picks; Send gives the agent the last one,
/// Skip tells it to decide itself. `onAnswer` gets the page's JSON, or nil to skip.
struct AskPage: View {
    let chatId: String
    let page: HtmlRender
    let busy: Bool
    /// The part of the screen the page may take before it scrolls itself.
    var share: CGFloat = 0.6
    let onAnswer: (String?) -> Void
    @State private var answer: String?
    @State private var width: Double?
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PageLoader(chatId: chatId, renderId: page.id, page: 0) { loaded in
                if let html = loaded.html {
                    let height = renderHeightAt(page.pages.first?.heights, width: width ?? 360) ?? unmeasuredHeight
                    RenderFrame(
                        page: phoneRenderDocument(html, theme: renderTheme(colors)), height: clampRenderHeight(Double(height)),
                        share: share, onAnswer: { answer = $0 }
                    ) {
                        Text("Loading the page…").font(.caption).foregroundStyle(colors.muted)
                    }
                } else {
                    Text(loaded.failed ? "The page didn't load. Answer it on the computer." : "Loading the page…")
                        .font(.caption)
                        .foregroundStyle(colors.muted)
                }
            }
            .onGeometryChange(for: Double.self, of: { $0.size.width }) { width = $0 }
            HStack(spacing: 8) {
                Spacer()
                Button("Skip") { onAnswer(nil) }.buttonStyle(.glass)
                Button("Send answer") { if let answer { onAnswer(answer) } }
                    .buttonStyle(.glassProminent)
                    .disabled(answer == nil)
            }
            .controlSize(.large)
            .disabled(busy)
        }
    }
}
