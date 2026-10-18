import RelayRemote
import SwiftUI

/// The desktop's Turn changes pane: what one agent turn changed, by folder,
/// each file opening its diff and rolling back on its own. Without a turn,
/// everything the thread's worktree has that the branch it came from doesn't
/// yet, and merging it there (Android's TurnScreen.kt).
struct TurnView: View {
    let chatId: String
    let messageId: String?
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @Environment(\.dismiss) private var dismiss
    @State private var rewind = Rewinding()
    @State private var status: WorktreeStatus?
    @State private var statusError: String?
    @State private var merging = false

    private var worktree: Bool { messageId == nil }
    private var thread: RemoteChat? { connection.threads[chatId] }
    private var turn: ChatMessage? { messageId.flatMap { id in thread?.messages.first { $0.id == id } } }

    var body: some View {
        let files = worktree ? status?.files : turn?.changes
        Loading(value: files, error: worktree ? statusError : connection.loadErrors[chatId], retry: reload) { files in
            list(files)
        }
        .relayBackground()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .rewindPrompts(rewind)
        .whenLive { await reload() }
        .sheet(isPresented: $merging) {
            if let thread {
                MergeSheet(where: thread.gitWhere, chatId: chatId, onMerged: { Task { await loadStatus() } }, onAsked: { dismiss() })
            }
        }
    }

    private var title: String {
        if worktree { return status?.branch ?? "Worktree" }
        return turn.map { "\(agentName($0.provider)) · \(Clock().clock($0.ended ?? $0.created))" } ?? "Changes"
    }

    private func list(_ files: [TurnFileChange]) -> some View {
        let reverted = files.filter { $0.revertedBy != nil }.count
        return List {
            VStack(spacing: 10) {
                HStack {
                    Text(summary(files, reverted: reverted))
                        .foregroundStyle(colors.muted)
                    Spacer()
                    if let messageId, !files.isEmpty {
                        let redo = reverted == files.count
                        Button(redo ? "Redo all" : "Roll back all", systemImage: redo ? "arrow.uturn.forward" : "arrow.uturn.backward") {
                            if redo {
                                rewind.run(chatId, messageId, nil, "redo")
                            } else {
                                rewind.ask(chatId, messageId, files: files.count - reverted)
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(rewind.working)
                    }
                }
                .font(.footnote)
                if worktree, let s = status, let from = s.from, s.landed == nil, !s.removed, !s.files.isEmpty {
                    Button { merging = true } label: {
                        Label("Merge into \(from)", systemImage: "arrow.triangle.merge").frame(maxWidth: .infinity)
                    }
                    .prominentGlass()
                    .controlSize(.large)
                }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            if files.isEmpty {
                Text("Nothing changed.")
                    .font(.subheadline)
                    .foregroundStyle(colors.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            ForEach(byFolder(files), id: \.folder) { group in
                Section {
                    ForEach(group.files, id: \.path) { f in row(f) }
                } header: {
                    if !group.folder.isEmpty {
                        Text("\(group.folder) · \(group.files.count)")
                            .font(.mono(.caption))
                            .foregroundStyle(colors.muted)
                            .textCase(nil)
                    }
                }
            }
        }
        .listStyle(.plain)
        .refreshable { await reload() }
    }

    private func summary(_ files: [TurnFileChange], reverted: Int) -> String {
        if let status, worktree { return worktreeSummary(status) }
        return "\(plural(files.count, "file")) changed\(reverted > 0 ? " · \(reverted) rolled back" : "")"
    }

    private func row(_ f: TurnFileChange) -> some View {
        HStack(spacing: 4) {
            let source: DiffSource =
                if let messageId { .turn(chatId: chatId, messageId: messageId, path: f.path) } else {
                    .worktree(chatId: chatId, path: f.path)
                }
            NavigationLink(value: Route.git(.diff(source))) {
                FileLine(file: f, folder: false)
            }
            if let messageId {
                let gone = f.revertedBy != nil
                Button(gone ? "Redo \(f.path)" : "Roll back \(f.path)", systemImage: gone ? "arrow.uturn.forward" : "arrow.uturn.backward") {
                    rewind.run(chatId, messageId, [f.path], gone ? "redo" : "revert")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .foregroundStyle(colors.muted)
                .frame(width: 40, height: 36)
                .disabled(rewind.working)
            }
        }
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(colors.border)
    }

    private func reload() async {
        if worktree {
            if thread == nil { await connection.load(chatId) }
            await loadStatus()
        } else {
            await connection.load(chatId)
        }
    }

    private func loadStatus() async {
        do {
            status = try await connection.liveClient().worktreeStatus(chatId)
            statusError = nil
        } catch {
            statusError = error.localizedDescription
        }
    }
}
