import RelayRemote
import SwiftUI

/// The started thread a branch list moves: its id, its branch now, and whether it's in its own worktree.
struct BranchThread: Hashable {
    let chatId: String
    let branch: String?
    let inWorktree: Bool
}

/// The project's branches, local then remote: switch to one, or start a new one
/// from where the checkout is. With a `thread`, picking one moves that thread
/// wherever it's worked on (Android's BranchesScreen.kt).
struct BranchesView: View {
    let projectId: String
    var thread: BranchThread? = nil
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @State private var list: BranchList?
    @State private var error: String?
    @State private var busy = false
    @State private var creating = false
    @State private var name = ""
    @State private var asks = Asks()

    var body: some View {
        Loading(value: list, error: error, retry: load) { list in
            List {
                let local = list.branches.filter { !$0.remote }
                let remote = list.branches.filter(\.remote)
                ForEach([("Local", local), ("Remote", remote)], id: \.0) { title, rows in
                    if !rows.isEmpty {
                        Section {
                            ForEach(rows, id: \.ref) { row($0, in: list) }
                        } header: {
                            GitSectionHeader(title: title, count: rows.count)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .refreshable { await load() }
        }
        .relayBackground()
        .navigationTitle("Branches")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // A new branch is made in the project folder, which a thread in its own worktree isn't in.
            if list != nil, thread?.inWorktree != true {
                ToolbarItem(placement: .primaryAction) {
                    Button("New Branch from Here", systemImage: "plus") { creating = true }.disabled(busy)
                }
            }
        }
        .alert("New branch from \(list?.current ?? "here")", isPresented: $creating) {
            TextField("feature/phone-remote", text: $name)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Create and Switch") { change("create", name.trimmingCharacters(in: .whitespaces)) { name = "" } }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .whenLive { await load() }
        .asks(asks)
    }

    /// The open thread's branch: its worktree's, or the project folder's when it works there.
    private var threadBranch: String? {
        guard let thread else { return nil }
        return thread.inWorktree ? thread.branch : (list?.current ?? thread.branch)
    }

    @ViewBuilder
    private func row(_ b: BranchRef, in list: BranchList) -> some View {
        if let pick = pick(b, in: list) {
            Button { pick() } label: {
                label(b).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .listRowBackground(Color.clear)
            .listRowSeparatorTint(colors.border)
        } else {
            label(b).listRowBackground(Color.clear).listRowSeparatorTint(colors.border)
        }
    }

    /// What tapping `b` does, nil when nothing: switch the project folder to it,
    /// or with a `thread`, go wherever it's worked on.
    private func pick(_ b: BranchRef, in list: BranchList) -> (() -> Void)? {
        guard let thread else {
            // The checked-out one, here or in a worktree, has nowhere to switch to.
            if b.current || b.worktree { return nil }
            return {
                asks.confirm("Switch to \(b.name)?", "Uncommitted changes that would be overwritten stop the switch.", "Switch") {
                    change("switch", b.name)
                }
            }
        }
        let move = branchMove(list, b, threadBranch: threadBranch, inWorktree: thread.inWorktree)
        if move == .stay { return nil }
        let ask = branchMoveAsk(move, b.name)
        return {
            asks.confirm(ask.title, ask.message, ask.action) {
                if move == .switchProjectFolder {
                    change("switch", b.name, refused: { moveThread(thread.chatId, b.name) }) { dismiss() }
                } else {
                    moveThread(thread.chatId, b.name)
                }
            }
        }
    }

    private func label(_ b: BranchRef) -> some View {
        HStack(spacing: 12) {
            let checked = thread == nil ? b.current : b.name == threadBranch
            Image(systemName: checked ? "checkmark" : "arrow.triangle.branch")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(checked ? colors.accent : colors.muted)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(b.name)
                    .font(.mono(.subheadline))
                    .foregroundStyle(colors.foreground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let note = branchRowNote(b, threadBranch: threadBranch) {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
    }

    private func load() async {
        do {
            list = try await connection.liveClient().branches(projectId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Switches to or creates `name`; `done` runs once it worked. A refused switch
    /// goes to `refused` when there is one, else says why.
    private func change(
        _ kind: String, _ name: String, refused: (() -> Void)? = nil, done: @escaping () -> Void = {}
    ) {
        guard let now = list, !name.isEmpty else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                list = try await connection.liveClient().changeBranch(
                    projectId, kind: kind, name: name, current: now.current, head: now.head)
                done()
            } catch {
                if let refused {
                    refused()
                } else {
                    asks.failure(error, kind == "switch" ? "Couldn't switch" : "Couldn't create it")
                }
                await load()
            }
        }
    }

    /// Moves thread `chatId` to `name`, wherever it's worked on, and goes back to it.
    private func moveThread(_ chatId: String, _ name: String) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await connection.liveClient().workOn(chatId, branch: name)
                dismiss()
            } catch {
                asks.failure(error, "Couldn't move it")
                await load()
            }
        }
    }
}
