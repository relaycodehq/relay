import RelayRemote
import SwiftUI

private let page = 100

/// The checked-out branch's commits, newest first (Android's HistoryScreen.kt).
struct HistoryView: View {
    let `where`: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var log: CommitLog?
    @State private var error: String?
    @State private var limit = page

    var body: some View {
        Loading(value: log, error: error, retry: load) { log in
            List {
                ForEach(log.commits, id: \.sha) { c in
                    NavigationLink(value: Route.git(.commit(where: self.where, sha: c.sha))) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Image(systemName: "smallcircle.filled.circle")
                                .font(.footnote)
                                .foregroundStyle(colors.faint)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(c.subject)
                                    .font(.subheadline)
                                    .foregroundStyle(colors.foreground)
                                    .lineLimit(2)
                                Text(historyLine(c, now: nowMs()))
                                    .font(.footnote)
                                    .foregroundStyle(colors.muted)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(colors.border)
                }
                if log.more {
                    Button("Older Commits") {
                        limit += page
                        Task { await load() }
                    }
                    .frame(maxWidth: .infinity)
                    .buttonStyle(.glass)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .refreshable { await load() }
        }
        .relayBackground()
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
        .whenLive { await load() }
    }

    private func load() async {
        do {
            log = try await connection.liveClient().history(self.where, limit: limit)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// One commit: its message, and the files it changed against its first parent.
struct CommitView: View {
    let `where`: String
    let sha: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var commit: CommitDetail?
    @State private var error: String?

    var body: some View {
        Loading(value: commit, error: error, retry: load) { c in
            List {
                VStack(alignment: .leading, spacing: 8) {
                    Text(c.subject).font(.headline).foregroundStyle(colors.foreground)
                    let body = c.body.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !body.isEmpty { Text(body).font(.subheadline).foregroundStyle(colors.foreground) }
                    Text("\(c.author) · \(Date(timeIntervalSince1970: Double(c.time)).formatted(date: .abbreviated, time: .shortened))")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                    Text(c.sha).font(.system(.caption, design: .monospaced)).foregroundStyle(colors.faint)
                }
                .textSelection(.enabled)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                Section {
                    ForEach(c.files, id: \.path) { f in
                        NavigationLink(value: Route.git(.diff(.commit(where: self.where, sha: sha, path: f.path)))) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(fileName(f.path))
                                    .font(.system(.subheadline, design: .monospaced))
                                    .foregroundStyle(colors.foreground)
                                    .lineLimit(1)
                                Text([folderOf(f.path), commitFileLine(f)].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.footnote)
                                    .foregroundStyle(colors.muted)
                                    .lineLimit(1)
                                    .truncationMode(.head)
                            }
                            .padding(.vertical, 2)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(colors.border)
                    }
                } header: {
                    GitSectionHeader(title: "Files", count: c.files.count)
                }
            }
            .listStyle(.plain)
        }
        .relayBackground()
        .navigationTitle(String(sha.prefix(7)))
        .navigationBarTitleDisplayMode(.inline)
        .whenLive { if commit == nil { await load() } }
    }

    private func load() async {
        do {
            commit = try await connection.liveClient().commit(self.where, sha: sha)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
