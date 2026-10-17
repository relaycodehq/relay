import RelayRemote
import SwiftUI

/// One file as a turn changed it, lines wrapped to the phone's width.
struct DiffView: View {
    let chatId: String
    let messageId: String
    let path: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var diff: RemoteDiff?
    @State private var error: String?

    var body: some View {
        Group {
            if let diff {
                if diff.binary {
                    ContentUnavailableView("Binary file", systemImage: "doc", description: Text("Nothing to show as text."))
                } else if diff.hunks.isEmpty {
                    ContentUnavailableView("No changes", systemImage: "doc", description: Text("The file is the same as before the turn."))
                } else {
                    lines(diff)
                }
            } else if let error {
                ContentUnavailableView("Couldn't load the diff", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .relayBackground()
        .navigationTitle(fileName(path))
        .navigationSubtitle(folderOf(path))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func lines(_ diff: RemoteDiff) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(rows(diff)) { row in
                    if let line = row.line {
                        DiffLine(line: line)
                    } else {
                        Text(row.header)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(colors.faint)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(colors.card)
                    }
                }
                if diff.truncated {
                    Text("Cut short here; Relay on your computer shows all of it.")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .padding(12)
                }
            }
            .padding(.bottom, 24)
        }
    }

    /// Hunk headers and lines in one list, each with an id of its own.
    private func rows(_ diff: RemoteDiff) -> [DiffRow] {
        diff.hunks.enumerated().flatMap { h, hunk in
            [DiffRow(id: "\(h)", header: hunk.header)]
                + hunk.lines.enumerated().map { DiffRow(id: "\(h).\($0)", header: "", line: $1) }
        }
    }

    private func load() async {
        do {
            diff = try await connection.diff(chatId, turn: messageId, path: path)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct DiffRow: Identifiable {
    let id: String
    let header: String
    var line: RemoteDiffLine?
}

private struct DiffLine: View {
    let line: RemoteDiffLine
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(line.new.map(String.init) ?? line.old.map(String.init) ?? "")
                .foregroundStyle(colors.faint)
                .frame(width: 32, alignment: .trailing)
            Text(line.kind == "add" ? "+" : line.kind == "del" ? "−" : " ")
                .foregroundStyle(line.kind == "add" ? colors.additionText : line.kind == "del" ? colors.deletionText : colors.faint)
            Text(line.text.isEmpty ? " " : line.text)
                .foregroundStyle(colors.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: 12, design: .monospaced))
        .padding(.trailing, 12)
        .padding(.vertical, 1)
        .background(line.kind == "add" ? colors.diffAddition : line.kind == "del" ? colors.diffDeletion : .clear)
    }
}
