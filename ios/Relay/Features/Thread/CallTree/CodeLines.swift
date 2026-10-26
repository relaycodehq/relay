import RelayMarkdown
import RelayRemote
import SwiftUI

/// One line as shown: its gutter, its tokens (or plain text past what was highlighted) and how it changed.
struct CodeLine {
    let gutter: String
    let tokens: [CodeToken]?
    let text: String
    let mark: LineMark
}

/// Rows past this many are counted rather than drawn: a box of thousands of lines stalls the thread.
private let shownLineLimit = 800

/// The lines in a box that scrolls both ways, tinted rows as wide as the box.
struct CodeLines: View {
    let hunks: [[CodeLine]]
    let cut: Bool
    @Environment(\.colors) private var colors
    @State private var width: CGFloat = 0

    var body: some View {
        let shown = firstLines(of: hunks)
        let widest = widestGutter(shown.hunks)
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(shown.hunks.enumerated()), id: \.offset) { index, hunk in
                    if index > 0 { Divider().overlay(colors.border).padding(.vertical, 4) }
                    ForEach(Array(hunk.enumerated()), id: \.offset) { _, line in row(line, widest: widest) }
                }
                if shown.left > 0 {
                    Text(verbatim: "…\(plural(shown.left, "more line")) not shown")
                        .foregroundStyle(colors.muted)
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                }
                if cut {
                    Text(verbatim: "…cut")
                        .foregroundStyle(colors.muted)
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                }
            }
            .font(.mono(.caption))
            .padding(.vertical, 6)
            .frame(minWidth: width, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        .onGeometryChange(for: CGFloat.self, of: \.size.width) { width = $0 }
        .frame(maxHeight: 280)
        .fixedSize(horizontal: false, vertical: true)
        .background(.codeBackground)
    }

    /// The lines a phone draws at once without stalling, and how many are left past them.
    private func firstLines(of hunks: [[CodeLine]]) -> (hunks: [[CodeLine]], left: Int) {
        var room = shownLineLimit
        var kept: [[CodeLine]] = []
        for hunk in hunks where room > 0 {
            kept.append(Array(hunk.prefix(room)))
            room -= kept[kept.count - 1].count
        }
        let total = hunks.reduce(0) { $0 + $1.count }
        return (kept, total - (shownLineLimit - room))
    }

    /// Room for the widest gutter drawn, so lines past 999 don't push their code over.
    private func widestGutter(_ hunks: [[CodeLine]]) -> String {
        let longest = hunks.joined().map(\.gutter.count).max() ?? 0
        return String(repeating: "0", count: longest)
    }

    private func row(_ line: CodeLine, widest: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            // The hidden widest number sizes the slot and gives the row its baseline.
            Text(verbatim: widest).hidden()
                .overlay(alignment: .trailing) {
                    Text(verbatim: line.gutter)
                        .foregroundStyle(line.mark == .same ? colors.faint : signColor(line.mark))
                }
                .frame(minWidth: 28, alignment: .trailing)
            Text(line.tokens.map { styledLine($0, dark: colors.dark) } ?? AttributedString(line.text))
                .fixedSize()
        }
        .padding(.trailing, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint(line.mark))
    }

    private func signColor(_ mark: LineMark) -> Color {
        mark == .added ? colors.additionText : colors.deletionText
    }

    private func tint(_ mark: LineMark) -> Color {
        switch mark {
        case .added: colors.diffAddition
        case .removed: colors.diffDeletion
        case .same: .clear
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
