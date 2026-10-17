import RelayRemote
import SwiftUI

/// The project's branches, local then remote: switch to one, or start a new one
/// from where the checkout is (Android's BranchesScreen.kt).
struct BranchesView: View {
    let projectId: String
    @Environment(Connection.self) private var connection
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
                            ForEach(rows, id: \.ref) { row($0) }
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
            if list != nil {
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

    @ViewBuilder
    private func row(_ b: BranchRef) -> some View {
        // The checked-out one, here or in a worktree, has nowhere to switch to.
        if b.current || b.worktree {
            label(b).listRowBackground(Color.clear).listRowSeparatorTint(colors.border)
        } else {
            Button {
                asks.confirm("Switch to \(b.name)?", "Uncommitted changes that would be overwritten stop the switch.", "Switch") {
                    change("switch", b.name)
                }
            } label: {
                label(b).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .listRowBackground(Color.clear)
            .listRowSeparatorTint(colors.border)
        }
    }

    private func label(_ b: BranchRef) -> some View {
        HStack(spacing: 12) {
            Image(systemName: b.current ? "checkmark" : "arrow.triangle.branch")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(b.current ? colors.accent : colors.muted)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(b.name)
                    .font(.system(.subheadline, design: .monospaced))
                    .foregroundStyle(colors.foreground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if b.current || b.worktree {
                    Text(b.current ? "Checked out" : "Checked out in a worktree")
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

    /// Switches to or creates `name`; `done` runs once it worked.
    private func change(_ kind: String, _ name: String, done: @escaping () -> Void = {}) {
        guard let now = list, !name.isEmpty else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                list = try await connection.liveClient().changeBranch(
                    projectId, kind: kind, name: name, current: now.current, head: now.head)
                done()
            } catch {
                asks.failure(error, kind == "switch" ? "Couldn't switch" : "Couldn't create it")
                await load()
            }
        }
    }
}
