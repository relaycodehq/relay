import RelayRemote
import SwiftUI

/// One file's change with lines wrapped to the phone's width: a turn's, the
/// working tree's, a commit's or a worktree's. Side by side when the phone is
/// turned wide enough and that's picked (Android's DiffScreen.kt).
struct DiffView: View {
    let source: DiffSource
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var diff: RemoteDiff?
    @State private var error: String?
    @State private var width: CGFloat = 0
    @AppStorage("relay-diff-layout") private var layout = "unified"

    /// Two columns of code need a phone on its side.
    private var wide: Bool { width >= 600 }
    private var split: Bool { wide && layout == "split" }

    var body: some View {
        Loading(value: diff, error: error, retry: load) { diff in
            if diff.binary {
                ContentUnavailableView(
                    "Binary file", systemImage: "doc", description: Text("Open it on your computer to see the change."))
            } else if diff.hunks.isEmpty {
                ContentUnavailableView("No changes", systemImage: "doc", description: Text("Nothing changed in this file."))
            } else {
                lines(diff)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .relayBackground()
        .navigationTitle(fileName(source.path))
        .navigationSubtitle(folderOf(source.path))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if wide {
                ToolbarItem(placement: .primaryAction) {
                    Button("Side by Side", systemImage: "rectangle.split.2x1") {
                        layout = layout == "split" ? "unified" : "split"
                    }
                    .tint(split ? colors.accent : colors.foreground)
                }
            }
        }
        .task { if diff == nil { await load() } }
    }

    private func lines(_ diff: RemoteDiff) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if split {
                    ForEach(Array(splitRows(diff).enumerated()), id: \.offset) { _, row in
                        switch row {
                        case .hunk(let header): HunkHeader(text: header)
                        case .pair(let left, let right): SplitLine(left: left, right: right)
                        }
                    }
                } else {
                    ForEach(rows(diff)) { row in
                        if let line = row.line { UnifiedLine(line: line) } else { HunkHeader(text: row.header) }
                    }
                }
                if diff.truncated {
                    Text("The rest of this diff is on your computer.")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .frame(maxWidth: .infinity)
                        .padding(16)
                }
            }
            .textSelection(.enabled)
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
            diff = try await connection.diff(source)
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

private let code = Font.mono(size: 12)
private let gutter = Font.mono(size: 11)

private struct HunkHeader: View {
    let text: String
    @Environment(\.colors) private var colors

    var body: some View {
        Text(text)
            .font(gutter)
            .foregroundStyle(colors.faint)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(colors.card)
    }
}

private func lineTint(_ kind: String?, _ colors: RelayColors) -> Color {
    kind == "add" ? colors.diffAddition : kind == "del" ? colors.diffDeletion : .clear
}

private struct UnifiedLine: View {
    let line: RemoteDiffLine
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text((line.kind == "del" ? line.old : line.new).map(String.init) ?? "")
                .font(gutter)
                .foregroundStyle(colors.faint)
                .frame(width: 32, alignment: .trailing)
            Text(line.kind == "add" ? "+" : line.kind == "del" ? "−" : " ")
                .foregroundStyle(line.kind == "add" ? colors.additionText : line.kind == "del" ? colors.deletionText : colors.faint)
            Text(line.text.isEmpty ? " " : line.text)
                .foregroundStyle(colors.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(code)
        .padding(.trailing, 12)
        .padding(.vertical, 1)
        .background(lineTint(line.kind, colors))
        .accessibilityElement(children: .combine)
    }
}

private struct SplitLine: View {
    let left: RemoteDiffLine?
    let right: RemoteDiffLine?
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 0) {
            half(left, left?.old)
            Rectangle().fill(colors.border).frame(width: 1)
            half(right, right?.new)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    private func half(_ line: RemoteDiffLine?, _ number: Int?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(number.map(String.init) ?? "")
                .font(gutter)
                .foregroundStyle(colors.faint)
                .frame(width: 32, alignment: .trailing)
            Text(line.map { $0.text.isEmpty ? " " : $0.text } ?? "")
                .font(code)
                .foregroundStyle(colors.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.trailing, 6)
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(line == nil ? colors.card : lineTint(line?.kind, colors))
    }
}
