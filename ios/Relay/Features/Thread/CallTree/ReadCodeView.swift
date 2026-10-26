import RelayMarkdown
import RelayRemote
import SwiftUI

/// What a read printed, opened like a written file: the file's own lines, highlighted, beside their
/// line numbers when the output says them. No header: the row above already names the file and lines.
struct ReadCodeView: View {
    let read: ReadCode
    @Environment(\.colors) private var colors

    var body: some View {
        CodeLines(hunks: [readLines(read)], cut: false)
            .clipShape(.rect(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(colors.border, lineWidth: 1))
    }
}

/// Each line with its number in the file, or an empty gutter when the output didn't say.
private func readLines(_ read: ReadCode) -> [CodeLine] {
    let tokens = Highlighted.lines(read.code, language: languageFor(read.file))
    // A run numbered from 0 says nothing about the file, as on the desktop.
    let first = read.first ?? 0
    return read.code.components(separatedBy: "\n").enumerated().map { index, text in
        let number = first > 0 ? "\(first + index)" : ""
        return CodeLine(gutter: number, tokens: tokens[safe: index], text: text, mark: .same)
    }
}
