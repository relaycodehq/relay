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
        let shown = shownCode(file)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if named || file.keptNothing {
                    Text(verbatim: baseName(file.path)).font(.mono(.caption)).foregroundStyle(colors.foreground)
                }
                size(shown.size)
            }
            .font(.caption.monospacedDigit())
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            if !file.keptNothing {
                Divider().overlay(colors.border)
                CodeLines(hunks: shown.hunks, cut: file.cut)
            }
        }
        .clipShape(.rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.border, lineWidth: 1))
    }

    @ViewBuilder private func size(_ size: CodeSize) -> some View {
        switch size {
        case .tooLong:
            Text(verbatim: "too long to keep").foregroundStyle(colors.muted)
        case .lines(let count):
            Text(verbatim: plural(count, "line")).foregroundStyle(colors.muted)
        case .changes(let added, let removed):
            HStack(spacing: 4) {
                Text(verbatim: "+\(added)").foregroundStyle(colors.additionText)
                Text(verbatim: "−\(removed)").foregroundStyle(colors.deletionText)
            }
        }
    }
}

/// What the header says of the code: how long a whole file is, or how much an edit changed.
private enum CodeSize {
    case tooLong
    case lines(Int)
    case changes(added: Int, removed: Int)
}

/// The written code as runs of lines, each edit of a swap a run of its own, and its size.
@MainActor
private func shownCode(_ file: WrittenCode) -> (hunks: [[CodeLine]], size: CodeSize) {
    if file.keptNothing { return ([], .tooLong) }
    let language = languageFor(file.path)
    switch file {
    case .whole(_, let content, _):
        return wholeFile(content, language: language)
    case .swap(_, let edits, _):
        let hunks = edits.map { edit in
            let before = Highlighted.lines(edit.old, language: language)
            let after = Highlighted.lines(edit.new, language: language)
            return marked(lineDiff(edit.old, edit.new), before: before, after: after)
        }
        return (hunks, changes(hunks))
    case .patch(_, let diff, _):
        // An added file from an older Codex turn is its content with no hunk.
        guard let lines = patchLines(diff) else { return wholeFile(diff, language: language) }
        let tokens = Highlighted.lines(lines.map(\.text).joined(separator: "\n"), language: language)
        let hunk = lines.enumerated().map { index, line in
            CodeLine(gutter: gutter(line.mark), tokens: tokens[safe: index], text: line.text, mark: line.mark)
        }
        return ([hunk], changes([hunk]))
    }
}

/// A file numbered line by line; past what the highlighter takes, the lines come plain.
@MainActor
private func wholeFile(_ content: String, language: String?) -> (hunks: [[CodeLine]], size: CodeSize) {
    let texts = content.components(separatedBy: "\n")
    let tokens = Highlighted.lines(content, language: language)
    let lines = texts.enumerated().map { index, text in
        CodeLine(gutter: "\(index + 1)", tokens: tokens[safe: index], text: text, mark: .same)
    }
    return ([lines], .lines(content.isEmpty ? 0 : texts.count))
}

private func changes(_ hunks: [[CodeLine]]) -> CodeSize {
    let lines = hunks.flatMap { $0 }
    return .changes(added: lines.count { $0.mark == .added }, removed: lines.count { $0.mark == .removed })
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
