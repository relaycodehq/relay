import RelayMarkdown
import RelayRemote
import SwiftUI

/// A file as it is on disk, highlighted by its extension, one numbered line per row; editing
/// stays on the computer (Android's FileScreen.kt).
struct FileView: View {
    let place: String
    let path: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var file: LocalFile?
    @State private var lines: [[CodeToken]]?
    @State private var total = 0
    @State private var error: String?

    var body: some View {
        Group {
            if let lines {
                ScrollView {
                    let gutter = CGFloat(String(lines.count).count * 8 + 10)
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(lines.indices, id: \.self) { i in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(i + 1)")
                                    .foregroundStyle(colors.faint)
                                    .frame(width: gutter, alignment: .trailing)
                                Text(styledLine(lines[i], dark: colors.dark))
                                    .foregroundStyle(colors.foreground)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 1)
                        }
                        if total > maxCodeLines {
                            Text("Showing the first \(maxCodeLines) of \(total) lines.")
                                .font(.caption)
                                .foregroundStyle(colors.muted)
                                .frame(maxWidth: .infinity)
                                .padding(12)
                        }
                    }
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.trailing, 12)
                    .padding(.vertical, 8)
                }
            } else if let error {
                RetryNote(message: error) { await load() }
                    .frame(maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            Text(path + (file.map { $0.branch.isEmpty ? "" : "  ·  \($0.branch)" } ?? ""))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(colors.muted)
                .lineLimit(1)
                .truncationMode(.head)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(colors.background)
        }
        .relayBackground()
        .navigationTitle(path.split(separator: "/").last.map(String.init) ?? path)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: connection.status.state == .online) {
            guard file == nil, connection.status.state == .online else { return }
            await load()
        }
    }

    private func load() async {
        do {
            let got = try await connection.liveClient().projectFile(where: place, path: path)
            let language = languageFor(path)
            // A long file takes a moment to cut into tokens; not on the main thread.
            let (cut, count) = await Task.detached {
                (highlight(firstLines(got.contents), language: language), got.contents.split(separator: "\n", omittingEmptySubsequences: false).count)
            }.value
            file = got
            lines = cut
            total = count
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}
