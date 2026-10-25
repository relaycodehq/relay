import RelayMarkdown
import RelayRemote
import SwiftUI

/// What a call wrote into one file, highlighted in the file's language: a whole file numbered,
/// an edit or a patch as a diff where only the changed lines are tinted.
struct WrittenCodeView: View {
    let file: WrittenCode
    /// Says which file, when the call wrote more than one.
    var named = false
    @Environment(\.colors) private var colors

    var body: some View {
        let hunks = codeHunks(file)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if named {
                    Text(verbatim: baseName(file.path)).font(.mono(.caption)).foregroundStyle(colors.foreground)
                }
                header(hunks)
            }
            .font(.caption.monospacedDigit())
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            Divider().overlay(colors.border)
            CodeLines(hunks: hunks, cut: file.cut)
        }
        .clipShape(.rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.border, lineWidth: 1))
    }

    @ViewBuilder private func header(_ hunks: [[CodeLine]]) -> some View {
        if case .whole(_, let content, _) = file {
            Text(verbatim: plural(content.isEmpty ? 0 : content.components(separatedBy: "\n").count, "line"))
                .foregroundStyle(colors.muted)
        } else {
            let lines = hunks.flatMap { $0 }
            HStack(spacing: 4) {
                Text(verbatim: "+\(lines.count { $0.mark == .added })").foregroundStyle(colors.additionText)
                Text(verbatim: "−\(lines.count { $0.mark == .removed })").foregroundStyle(colors.deletionText)
            }
        }
    }
}

/// One line as shown: its gutter, its tokens (or plain text past what was highlighted) and how it changed.
struct CodeLine {
    let gutter: String
    let tokens: [CodeToken]?
    let text: String
    let mark: LineMark
}

/// The written code as runs of lines; each edit of a swap is a run of its own.
@MainActor
private func codeHunks(_ file: WrittenCode) -> [[CodeLine]] {
    let language = languageFor(file.path)
    switch file {
    case .whole(_, let content, _):
        let lines = Highlighted.lines(content, language: language)
        return [lines.enumerated().map { CodeLine(gutter: "\($0.offset + 1)", tokens: $0.element, text: "", mark: .same) }]
    case .swap(_, let edits, _):
        return edits.map { edit in
            let before = Highlighted.lines(edit.old, language: language)
            let after = Highlighted.lines(edit.new, language: language)
            return marked(lineDiff(edit.old, edit.new), before: before, after: after)
        }
    case .patch(_, let diff, _):
        let lines = patchLines(diff)
        let tokens = Highlighted.lines(lines.map(\.text).joined(separator: "\n"), language: language)
        return [lines.enumerated().map { index, line in
            CodeLine(gutter: gutter(line.mark), tokens: tokens[safe: index], text: line.text, mark: line.mark)
        }]
    }
}

/// Diff lines with their highlighting, taken from whichever side each line came from.
private func marked(_ diff: [DiffLine], before: [[CodeToken]], after: [[CodeToken]]) -> [CodeLine] {
    var old = 0
    var new = 0
    return diff.map { line in
        let tokens: [CodeToken]?
        switch line.mark {
        case .removed:
            tokens = before[safe: old]
            old += 1
        case .added:
            tokens = after[safe: new]
            new += 1
        case .same:
            tokens = after[safe: new]
            old += 1
            new += 1
        }
        return CodeLine(gutter: gutter(line.mark), tokens: tokens, text: line.text, mark: line.mark)
    }
}

private func gutter(_ mark: LineMark) -> String {
    switch mark {
    case .added: "+"
    case .removed: "−"
    case .same: ""
    }
}

extension Array {
    fileprivate subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

/// The lines in a box that scrolls both ways, tinted rows as wide as the box.
private struct CodeLines: View {
    let hunks: [[CodeLine]]
    let cut: Bool
    @Environment(\.colors) private var colors
    @State private var width: CGFloat = 0

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(hunks.enumerated()), id: \.offset) { index, hunk in
                    if index > 0 { Divider().overlay(colors.border).padding(.vertical, 4) }
                    ForEach(Array(hunk.enumerated()), id: \.offset) { _, line in row(line) }
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

    private func row(_ line: CodeLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: line.gutter)
                .foregroundStyle(line.mark == .same ? colors.faint : signColor(line.mark))
                .frame(width: 28, alignment: .trailing)
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
