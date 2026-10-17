import RelayRemote
import SwiftUI

/// The page a turn left open in the computer's preview: its address, and the last frame of
/// it the turn kept, fading out at the bottom. From `Bridge.preview`.
struct TurnPreviewCard: View {
    let chatId: String
    let messageId: String
    let preview: TurnPreview
    @Environment(Connection.self) private var connection
    @Environment(\.openURL) private var openURL
    @Environment(\.colors) private var colors

    private var short: String {
        preview.url.replacingOccurrences(of: "^https?://", with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// A page the phone opens itself, or the computer's own through the tunnel.
    private var opens: Bool {
        guard let url = URL(string: preview.url), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            return false
        }
        return LocalUrls.link(preview.url) == nil || connection.canTunnel
    }

    var body: some View {
        if (connection.overview?.bridge ?? 1) >= Bridge.preview {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Image(systemName: "globe").font(.caption2)
                    Text(short).font(.caption).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                    if opens {
                        Image(systemName: "arrow.up.right.square").font(.footnote)
                    }
                }
                .foregroundStyle(colors.muted)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(colors.fill)
                .contentShape(.rect)
                .onTapGesture { if opens, let url = URL(string: preview.url) { openURL(url) } }
                .accessibilityAddTraits(opens ? .isLink : [])
                if preview.shot == true {
                    Frame(source: .preview(chatId: chatId, messageId: messageId), name: preview.title.isEmpty ? short : preview.title)
                }
            }
            .clipShape(.rect(cornerRadius: 10))
            .overlay {
                // The frame's sides fade out with it, so its lower edge never shows.
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(colors.border, lineWidth: 0.5)
                    .mask {
                        LinearGradient(
                            stops: [.init(color: .black, location: preview.shot == true ? 0.6 : 1), .init(color: .clear, location: 1)],
                            startPoint: .top, endPoint: .bottom)
                    }
            }
        }
    }
}

private struct Frame: View {
    let source: ImageSource
    let name: String
    @Environment(\.openImage) private var openImage
    @Environment(\.displayScale) private var scale
    @Environment(\.colors) private var colors

    var body: some View {
        RemoteImage(source: source, max: Int(430 * scale)) { loaded in
            if !loaded.failed {
                Button { openImage?(source, among: [MessageImage(source: source, name: name)]) } label: {
                    Color.clear
                        .frame(maxWidth: .infinity)
                        .frame(height: 200)
                        .overlay(alignment: .top) {
                            if let picture = loaded.image {
                                Image(uiImage: picture).resizable().scaledToFill()
                            }
                        }
                        .clipped()
                        .mask {
                            LinearGradient(
                                stops: [.init(color: .black, location: 0.72), .init(color: .clear, location: 1)],
                                startPoint: .top, endPoint: .bottom)
                        }
                }
                .buttonStyle(.plain)
                .disabled(loaded.image == nil)
                .accessibilityLabel("Preview of \(name)")
                .zoomSource(source)
            }
        }
    }
}
