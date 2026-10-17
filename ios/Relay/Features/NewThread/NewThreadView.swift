import RelayRemote
import SwiftUI

/// What the project choice holds for a Scratchpad chat, in whichever folder the desktop hands out.
private let scratchWhere = "scratch"
private let scratchHint = "A chat of its own, outside your projects"

/// Starts a thread the way the desktop's new-thread composer does: in the
/// project used last, on the agent and model picked last, then opens it.
struct NewThreadView: View {
    /// The thread the first message made.
    let started: (String) -> Void
    @Environment(Connection.self) private var connection
    @State private var projectId: String?
    /// Picks here, per project; each starts where its settings say.
    @State private var workspaces: [String: String] = [:]
    /// The desktop's new chat: an unused Scratchpad folder, or a fresh one, asked once.
    @State private var scratchId: String?
    @State private var scratchError: String?
    @State private var placed = false
    @FocusState private var composing: Bool

    init(projectId: String? = nil, scratch: Bool = false, started: @escaping (String) -> Void) {
        _projectId = State(initialValue: scratch ? scratchWhere : projectId)
        self.started = started
    }

    private var scratch: Bool { projectId == scratchWhere }

    private var projects: [RemoteProject] { projectsByUse(connection.overview?.projects ?? [], connection.chats) }
    private var project: RemoteProject? { projects.first { $0.id == projectId } }
    /// None for a folder that isn't a git checkout.
    private var workspace: String? {
        guard let project, project.plain != true else { return nil }
        return workspaces[project.id] ?? project.workspace ?? "checkout"
    }

    /// Picks here are what the next new thread opens on too, here or on the computer.
    private var settings: Binding<ResumeSettings?> {
        Binding(
            get: { connection.newThread?.settings },
            set: { next in
                guard let next, let before = connection.newThread?.settings else { return }
                connection.rememberNewThread(next, over: before)
            })
    }

    var body: some View {
        VStack(spacing: 8) {
            Spacer()
            if projects.isEmpty && !scratch {
                ContentUnavailableView(
                    "No projects", systemImage: "folder",
                    description: Text("Add one in Relay on your computer to start a thread in it."))
            } else {
                place
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .contentShape(.rect)
        .onTapGesture { composing = false }
        .safeAreaInset(edge: .bottom) {
            Composer(
                chatId: nil, projectId: scratch ? scratchId : projectId, settings: settings,
                remembered: connection.newThread?.models,
                placeholder: scratch ? "Ask anything" : "What should we work on?", focused: $composing
            ) { sent in
                let place = scratch ? try await scratchFolder() : projectId
                guard let place else { throw PairingError("Pick a project first.") }
                started(
                    try await connection.start(
                        in: place, workspace: workspace, sent.text, images: sent.images, with: sent.settings,
                        sendAt: sent.sendAt))
            }
        }
        .relayBackground()
        .navigationTitle("New thread")
        .usageToolbar(provider: connection.newThread?.settings.provider)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: connection.status.state) { await connection.loadNewThread() }
        .task(id: scratch && connection.status.state == .online) {
            if scratch && connection.status.state == .online { _ = try? await scratchFolder() }
        }
        .onAppear {
            guard !placed, connection.overview != nil else { return }
            projectId = startingWhere()
            placed = true
        }
        .onChange(of: projects.map(\.id)) { _, ids in
            // The project went away on the computer: the next one used.
            if !scratch, projectId.map({ !ids.contains($0) }) ?? true { projectId = ids.first ?? scratchWhere }
        }
    }

    /// What the screen was opened for, else where the latest thread is. From a Scratchpad
    /// thread, /new means another Scratchpad chat, not that folder.
    private func startingWhere() -> String? {
        if scratch { return scratchWhere }
        let wanted = connection.project(projectId ?? "") ?? connection.chats.first.flatMap { connection.project($0.projectId) }
        if let wanted { return wanted.scratch == true ? scratchWhere : wanted.id }
        return projects.first?.id ?? scratchWhere
    }

    private func scratchFolder() async throws -> String {
        if let scratchId { return scratchId }
        do {
            let id = try await connection.createScratch()
            scratchId = id
            scratchError = nil
            return id
        } catch {
            scratchError = error.localizedDescription
            throw error
        }
    }

    /// Which project, and whether it works in the checkout or a worktree of its own.
    private var place: some View {
        VStack(spacing: 6) {
            Menu {
                Picker("Project", selection: $projectId) {
                    Label("Scratchpad", systemImage: "note.text").tag(Optional(scratchWhere))
                    Divider()
                    ForEach(projects) { Text($0.name).tag(Optional($0.id)) }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(scratch ? "Scratchpad" : project?.name ?? "Pick a project")
                        .font(.title2.weight(.semibold))
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.secondary)
                }
                // Plain colours: a menu's label takes the tint otherwise.
                .foregroundStyle(Color.primary)
            }
            .accessibilityLabel("Project: \(scratch ? "Scratchpad" : project?.name ?? "none")")
            if scratch {
                // A Scratchpad that couldn't be made says why, and asks again on a tap.
                Button(scratchError ?? scratchHint) { Task { _ = try? await scratchFolder() } }
                    .font(.subheadline)
                    .foregroundStyle(scratchError == nil ? Color.secondary : Color.red)
                    .disabled(scratchError == nil)
            } else if let workspace, let project {
                Menu {
                    // Toggles rather than a Picker: a menu shows a toggle's second line.
                    ForEach(Workspace.all) { w in
                        Toggle(isOn: Binding(get: { workspace == w.id }, set: { if $0 { workspaces[project.id] = w.id } })) {
                            Text(w.label)
                            Text(w.hint)
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(Workspace.label(workspace))
                        Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold))
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color.secondary)
                }
                .accessibilityLabel("Works in: \(Workspace.label(workspace))")
            }
        }
    }
}

private struct Workspace: Identifiable {
    let id: String
    let label: String
    let hint: String

    static let all = [
        Workspace(id: "checkout", label: "Project folder", hint: "Works in the checkout, on whatever branch it has."),
        Workspace(
            id: "worktree", label: "Its own worktree",
            hint: "A branch and folder of its own; your checkout stays as it is."),
    ]

    static func label(_ id: String) -> String { all.first { $0.id == id }?.label ?? id }
}

/// The projects a new thread can start in, the one used last first.
func projectsByUse(_ projects: [RemoteProject], _ chats: [RemoteChatSummary]) -> [RemoteProject] {
    var order: [String: Int] = [:]
    for (i, chat) in chats.enumerated() where order[chat.projectId] == nil { order[chat.projectId] = i }
    return projects.enumerated()
        .filter { $0.element.scratch != true }
        .sorted { (order[$0.element.id] ?? .max, $0.offset) < (order[$1.element.id] ?? .max, $1.offset) }
        .map(\.element)
}
