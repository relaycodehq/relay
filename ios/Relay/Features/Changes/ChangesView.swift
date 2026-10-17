import RelayRemote
import SwiftUI

/// The desktop's Changes pane: commit and push everything in one go, or stage
/// and commit a part (Android's ChangesScreen.kt). Swipe a file, or tap its
/// button, to stage or unstage it; tap it for its diff.
struct ChangesView: View {
    @State private var model: ChangesModel
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    init(where: String) { _model = State(initialValue: ChangesModel(where: `where`)) }

    var body: some View {
        Loading(value: model.tree, error: model.error, retry: model.load) { tree in
            list(tree)
                .safeAreaBar(edge: .bottom) {
                    if !tree.changes.isEmpty { CommitDock(model: model, tree: tree) }
                }
        }
        .relayBackground()
        .navigationTitle(model.tree.map { $0.branch.isEmpty ? "Changes" : $0.branch } ?? "Changes")
        .navigationSubtitle(model.tree.map { $0.branch.isEmpty ? "" : "Changes" } ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.bind(connection) }
        .whenLive { await model.load() }
        .asks(model.asks)
        .sensoryFeedback(.success, trigger: model.tree?.revision)
    }

    private func list(_ tree: WorkingTree) -> some View {
        let busy = model.busy != nil
        let staged = tree.changes.filter(\.staged)
        let working = tree.changes.filter(\.unstaged)
        return List {
            if let op = tree.operation {
                Text("\(operationInProgress(op)). Finish it on your computer.")
                    .font(.footnote)
                    .foregroundStyle(colors.destructive)
                    .listRowBackground(Color.clear)
            }
            if tree.changes.isEmpty {
                Text("No uncommitted changes.")
                    .font(.subheadline)
                    .foregroundStyle(colors.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            area("Staged changes", staged, staged: true, tree: tree, busy: busy)
            area("Working changes", working, staged: false, tree: tree, busy: busy)
            RemoteSection(model: model, tree: tree)
        }
        .listStyle(.plain)
        .scrollDismissesKeyboard(.immediately)
        .refreshable { await model.load() }
    }

    @ViewBuilder
    private func area(_ title: String, _ files: [WorkingChange], staged: Bool, tree: WorkingTree, busy: Bool) -> some View {
        if !files.isEmpty {
            Section {
                ForEach(files, id: \.path) { f in
                    FileRow(file: f, staged: staged, busy: busy, where: model.where) {
                        toggle([f.path], staged: staged, tree: tree)
                    }
                }
            } header: {
                HStack {
                    GitSectionHeader(title: title, count: files.count)
                    Spacer()
                    Button(staged ? "Unstage All" : "Stage All") { toggle(files.map(\.path), staged: staged, tree: tree) }
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(busy ? colors.faint : colors.foreground)
                        .disabled(busy)
                }
            }
        }
    }

    private func toggle(_ paths: [String], staged: Bool, tree: WorkingTree) {
        if staged {
            model.act(.unstage, .unstage(revision: tree.revision, paths: paths))
        } else {
            model.act(.stage, .stage(revision: tree.revision, paths: paths))
        }
    }
}

/// A changed file: its letter, name and folder; opening its diff, staging or unstaging it.
private struct FileRow: View {
    let file: WorkingChange
    let staged: Bool
    let busy: Bool
    let `where`: String
    let toggle: () -> Void
    @Environment(\.colors) private var colors
    @Environment(\.navigate) private var navigate

    var body: some View {
        let code = staged ? file.index : file.worktree
        let dir = folderOf(file.path)
        HStack(spacing: 10) {
            Button {
                navigate(.git(.diff(.working(where: self.where, path: file.path, area: staged ? "staged" : "unstaged"))))
            } label: {
                HStack(spacing: 10) {
                    ChangeLetter(code: code, conflict: file.conflict)
                    let name = Text(fileName(file.path)).foregroundStyle(colors.foreground)
                    let place = Text(dir.isEmpty ? "" : "  \(dir)").foregroundStyle(colors.faint)
                    Text("\(name)\(place)")
                        .font(.system(.footnote, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            Button(staged ? "Unstage \(file.path)" : "Stage \(file.path)", systemImage: staged ? "minus" : "plus", action: toggle)
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .foregroundStyle(colors.muted)
                .frame(width: 36, height: 32)
                .disabled(busy)
        }
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(colors.border)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(staged ? "Unstage" : "Stage", systemImage: staged ? "minus.circle" : "plus.circle", action: toggle)
                .tint(staged ? .gray : .green)
                .disabled(busy)
        }
    }
}

/// Where the branch stands against its remote, what's to push, and Fetch, Pull and Push.
private struct RemoteSection: View {
    let model: ChangesModel
    let tree: WorkingTree
    @Environment(\.colors) private var colors

    var body: some View {
        let busy = model.busy != nil
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(remoteLine(tree))
                    .font(.footnote)
                    .foregroundStyle(colors.muted)
                ForEach(tree.outgoing, id: \.sha) { commit in
                    let sha = Text(commit.sha.prefix(7) + " ").font(.system(.footnote, design: .monospaced)).foregroundStyle(colors.faint)
                    Text("\(sha)\(Text(commit.subject).foregroundStyle(colors.foreground))")
                        .font(.footnote)
                        .lineLimit(1)
                }
                HStack(spacing: 8) {
                    Button(model.busy == .fetch ? "Fetching…" : "Fetch") { model.act(.fetch, .fetch) }
                        .quietGlass()
                        .disabled(busy)
                    if tree.behind > 0 {
                        Button(model.busy == .pull ? "Pulling…" : "Pull") { model.act(.pull, .pull(revision: tree.revision)) }
                            .quietGlass()
                            .disabled(busy || tree.operation != nil)
                    }
                    let push = Button(model.busy == .push ? "Pushing…" : "Push") {
                        let (title, message) = pushQuestion(tree)
                        model.asks.confirm(title, message, "Push") { model.act(.push, .push(revision: tree.revision)) }
                    }
                    .disabled(!canPush(tree, busy: busy))
                    if tree.changes.isEmpty { push.prominentGlass() } else { push.quietGlass() }
                }
                .padding(.top, 6)
            }
            .padding(.vertical, 6)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } header: {
            GitSectionHeader(title: "Remote")
        }
    }
}

/// Pinned under the list, so the one-step commit is in reach however many files changed.
private struct CommitDock: View {
    @Bindable var model: ChangesModel
    let tree: WorkingTree
    @Environment(\.colors) private var colors

    var body: some View {
        let staged = tree.changes.filter(\.staged)
        let working = tree.changes.filter(\.unstaged)
        let all = everyPath(tree)
        let stop = commitBlocker(tree)
        // Committing while a message is on its way would go without it, unless you've typed your own.
        let ready =
            model.busy == nil && stop == nil && !model.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !(model.writing && !model.typed)
        let canShip = ready && !all.isEmpty && all.count <= maxCommitFiles
        // With some of it staged, the message describes that part.
        let partial = !staged.isEmpty && !working.isEmpty
        let writeFor = partial ? staged.map(\.path) : all
        let canWrite = !model.writing && model.busy == nil && !writeFor.isEmpty && writeFor.count <= maxCommitFiles
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(commitHint(tree))
                    .font(.footnote)
                    .foregroundStyle(stop != nil ? colors.destructive : colors.muted)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(model.writing ? "Writing…" : partial ? "Write for Staged" : "Write It for Me", systemImage: "sparkles") {
                    model.writeNow(writeFor)
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(canWrite ? colors.accent : colors.faint)
                .disabled(!canWrite)
            }
            TextField(
                model.writing && !model.typed ? "Writing a message…" : "Commit message", text: $model.message, axis: .vertical
            )
            .lineLimit(2...5)
            .font(.subheadline)
            .padding(10)
            .background(.quietFill, in: .rect(cornerRadius: 14))
            .onChange(of: model.message) { _, text in
                if text.count > maxCommitMessage { model.message = String(text.prefix(maxCommitMessage)) }
            }
            HStack(spacing: 8) {
                if !staged.isEmpty {
                    Button { model.commit(nil, push: false) } label: {
                        Text(model.busy == .commit ? "Committing…" : "Commit Staged").frame(maxWidth: .infinity)
                    }
                    .quietGlass()
                    .disabled(!(ready && !staged.isEmpty))
                }
                Button { model.commit(all, push: tree.pushTarget != nil) } label: {
                    Text(shipLabel).frame(maxWidth: .infinity)
                }
                .prominentGlass()
                .disabled(!canShip)
            }
            .controlSize(.large)
            .lineLimit(1)
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }

    private var shipLabel: String {
        switch model.busy {
        case .ship: "Committing…"
        case .push: "Pushing…"
        default: tree.pushTarget != nil ? "Commit & Push" : "Commit"
        }
    }
}
