import RelayRemote
import SwiftUI

/// Commits listed before "and N more".
private let listed = 8

/// The desktop's MergeSheet for a thread's worktree: its branch into the one it
/// came from, pushed along if that has a remote. Merging happens in a folder of
/// its own, so a conflict changes nothing; the thread's agent can then be asked
/// to resolve it (Android's MergeSheet.kt).
struct MergeSheet: View {
    let `where`: String
    let chatId: String
    let onMerged: () -> Void
    /// The agent was asked to resolve the conflicts: back to the thread.
    var onAsked: () -> Void = {}
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @Environment(\.dismiss) private var dismiss
    @State private var base: String?
    @State private var plan: MergePlan?
    @State private var push = true
    @State private var busy = false
    @State private var error: String?
    @State private var result: MergeResult?

    var body: some View {
        NavigationStack {
            Group {
                if let plan, let result, result.merged {
                    merged(plan, result)
                } else if let plan {
                    planBody(plan)
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn't plan the merge", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try Again") { Task { await loadPlan() } }.buttonStyle(.glass)
                    }
                } else {
                    Spinner.page
                }
            }
            .navigationTitle(result?.merged == true ? "Merged into \(result?.base ?? plan?.base ?? "")" : "Merge Branch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }.disabled(busy)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
        .task(id: base) { await loadPlan() }
    }

    private func merged(_ plan: MergePlan, _ result: MergeResult) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            let how = result.fastForward == true ? " (fast-forward)" : " as a merge commit"
            let pushed = result.pushedTo.map { Text(" and pushed to \(mono($0))") } ?? Text("")
            Text("\(mono(plan.branch)) is in \(mono(result.base ?? plan.base))\(how)\(pushed).")
            Button { dismiss() } label: { Text("Done").frame(maxWidth: .infinity) }
                .prominentGlass()
                .controlSize(.large)
            Spacer()
        }
        .padding(20)
    }

    private func planBody(_ plan: MergePlan) -> some View {
        let commits = plan.commits.count
        let pushing = push && plan.pushTarget != nil
        let conflicted = result.map { !$0.merged } ?? false
        return Form {
            Section {
                Text("\(mono(plan.branch)) into \(mono(plan.base))")
                if plan.bases.count > 1 {
                    Picker("Into", selection: Binding(get: { plan.base }, set: { pick($0) })) {
                        ForEach(plan.bases.prefix(5), id: \.self) { Text($0).font(.system(.body, design: .monospaced)).tag($0) }
                    }
                    .disabled(busy)
                }
                if let target = plan.pushTarget {
                    Toggle(isOn: $push) { Text("Push \(plan.base) to \(mono(target))") }.disabled(busy)
                }
            }
            Section {
                if commits > 0 {
                    ForEach(plan.commits.prefix(listed), id: \.sha) { c in
                        Text("\(Text(c.sha.prefix(7)).font(.system(.footnote, design: .monospaced)).foregroundStyle(colors.muted)) \(c.subject)")
                            .font(.subheadline)
                            .lineLimit(1)
                    }
                    if commits > listed {
                        Text("and \(commits - listed) more").font(.footnote).foregroundStyle(colors.muted)
                    }
                } else {
                    Text("\(plan.base) already has everything on \(plan.branch).").foregroundStyle(colors.muted)
                }
            } header: {
                if commits > 0 {
                    Text("\(commits == 50 ? "Latest 50" : "\(commits)") \(commits == 1 ? "commit" : "commits") · \(plan.fastForward ? "fast-forward" : "creates a merge commit")")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(colors.muted)
                }
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(notes(plan), id: \.self) { Text($0) }
                }
            }
            if let result, !result.merged {
                Section {
                    ForEach(result.conflicts ?? [], id: \.self) {
                        Text($0).font(.system(.footnote, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                    }
                    Button("Ask the Agent to Resolve Them", systemImage: "bubble.left") { ask(plan, result.conflicts ?? []) }
                        .disabled(busy)
                } header: {
                    Text("These files conflict, so nothing was merged")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(colors.destructive)
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(colors.destructive) }
            }
            Section {
                Button { merge(plan, push: pushing) } label: {
                    Text(busy ? "Merging…" : pushing ? "Merge & Push \(plan.base)" : "Merge into \(plan.base)")
                        .frame(maxWidth: .infinity)
                }
                .prominentGlass()
                .controlSize(.large)
                .disabled(busy || commits == 0 || conflicted)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .scrollContentBackground(.hidden)
    }

    private func notes(_ plan: MergePlan) -> [String] {
        var out: [String] = []
        if plan.uncommitted > 0 {
            let one = plan.uncommitted == 1
            out.append("\(plan.uncommitted) uncommitted \(one ? "file stays" : "files stay") in the worktree and \(one ? "isn’t" : "aren’t") merged.")
        }
        if let at = plan.checkedOutAt {
            out.append("Also moves \(plan.base) where it’s checked out, in \(fileName(at)). Uncommitted edits there stay; if one touches a file this merge changes, nothing happens.")
        }
        if plan.snapshots > 0 {
            out.append("Includes \(plan.snapshots == 1 ? "a commit" : "\(plan.snapshots) commits") Relay made of the checkout’s uncommitted edits when this worktree started; merging lands those edits too.")
        }
        return out
    }

    private func mono(_ s: String) -> Text { Text(s).font(.system(.body, design: .monospaced)) }

    private func pick(_ name: String) {
        guard name != plan?.base else { return }
        result = nil
        plan = nil
        base = name
    }

    private func loadPlan() async {
        error = nil
        do {
            plan = try await connection.liveClient().mergePlan(self.where, base: base)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func step(_ work: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do { try await work() } catch { self.error = error.localizedDescription }
        }
    }

    private func merge(_ plan: MergePlan, push: Bool) {
        step {
            let merged = try await connection.liveClient().mergeBranch(self.where, plan, push: push)
            result = merged
            if merged.merged { onMerged() }
        }
    }

    private func ask(_ plan: MergePlan, _ conflicts: [String]) {
        step {
            try await connection.send(resolveConflictsAsk(plan, conflicts), to: chatId)
            dismiss()
            onAsked()
        }
    }
}
