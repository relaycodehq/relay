import SwiftUI

/// The libraries and assets in this app, with their licence texts (Android's LicencesScreen.kt).
struct LicencesView: View {
    @Environment(\.colors) private var colors
    @State private var blocks: [NoticeBlock] = []

    var body: some View {
        List {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                Text(block.text)
                    .font(block.heading ? .body.weight(.medium) : .footnote)
                    .foregroundStyle(block.heading ? colors.foreground : colors.muted)
                    .padding(.top, block.heading ? 14 : 0)
                    .textSelection(.enabled)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .relayBackground()
        .navigationTitle("Open-source licences")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard blocks.isEmpty, let url = Bundle.main.url(forResource: "third-party-notices", withExtension: "txt"),
                let text = try? String(contentsOf: url, encoding: .utf8)
            else { return }
            blocks = noticeBlocks(text)
        }
    }
}

struct NoticeBlock: Equatable {
    let text: String
    let heading: Bool
}

/// The notices file's paragraphs: `# ` starts a section, a blank line a paragraph.
func noticeBlocks(_ text: String) -> [NoticeBlock] {
    text.replacingOccurrences(of: "\r\n", with: "\n")
        .split(separator: /\n[ \t]*\n/)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .map { $0.hasPrefix("# ") ? NoticeBlock(text: String($0.dropFirst(2)), heading: true) : NoticeBlock(text: $0, heading: false) }
}
