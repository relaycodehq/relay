import RelayRemote
import SwiftUI

/// What the project choice holds for a Scratchpad chat, in whichever folder the desktop hands out.
private let scratchWhere = "scratch"
private let scratchHint = "A chat of its own, outside your projects"
private let asideNeedsAnswer = "Ask the agent something first, then ask on the side."

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
    /// The draft being written for the project picked, its text following the pick.
    @State private var draftKey: String?
    /// A new thread's draft picked from Home, written on while its project stays picked.
    private let opened: String?
    /// The thread made for a send that then failed, used again on the next try to the same place.
    @State private var made: (computer: String, place: String, chat: CreatedChat)?
    @FocusState private var composing: Bool

    init(projectId: String? = nil, scratch: Bool = false, draftKey: String? = nil, started: @escaping (String) -> Void) {
        _projectId = State(initialValue: scratch ? scratchWhere : projectId ?? draftKey.flatMap(newDraftProject))
        opened = draftKey
        self.started = started
    }

    private var scratch: Bool { projectId == scratchWhere }

    private var projects: [RemoteProject] { projectsByUse(connection.overview?.projects ?? [], connection.listed) }
    private var project: RemoteProject? { projects.first { $0.id == projectId } }
    /// None for a folder that isn't a git checkout. A pick here, else the draft's own (picked
    /// here before, or on the computer), else where the project's settings say.
    private var workspace: String? {
        guard let project, project.plain != true else { return nil }
        let drafted = connection.active.flatMap { pc in draftKey.flatMap { connection.drafts.workspace(pc, $0) } }
        return workspaces[project.id] ?? drafted ?? project.workspace ?? "checkout"
    }

    private func pickWorkspace(_ id: String, for project: RemoteProject) {
        workspaces[project.id] = id
        // Kept with the draft, so the computer's composer and a later visit start there too.
        guard let pc = connection.active, let draftKey, !scratch else { return }
        connection.drafts.edit(pc, draftKey) { body in
            var next = body
            next.workspace = id
            return next
        }
    }

    /// Open threads in the project picked, to carry on one rather than start another.
    private var recent: [RemoteChatSummary] {
        guard let project else { return [] }
        return Array(connection.listed.filter { $0.projectId == project.id && !chatSettled($0) }.prefix(5))
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
        // Scrolls once the keyboard and a tall composer leave too little room: a plain stack that
        // overflowed grew the screen, and the composer below it slid under the keyboard.
        ScrollView {
            VStack(spacing: 8) {
                if projects.isEmpty && !scratch {
                    ContentUnavailableView(
                        "No projects", systemImage: "folder",
                        description: Text("Add one in Relay on your computer to start a thread in it."))
                } else {
                    place
                    if !recent.isEmpty {
                        RecentThreads(chats: recent, open: started).padding(.top, 20)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .defaultScrollAnchor(.center, for: .alignment)
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .contentShape(.rect)
        .onTapGesture { composing = false }
        .safeAreaInset(edge: .bottom) {
            Composer(
                chatId: nil, projectId: scratch ? scratchId : projectId, draftKey: draftKey, settings: settings,
                remembered: connection.newThread?.models,
                placeholder: scratch ? "Ask anything" : "What should we work on?", focused: $composing
            ) { sent in
                guard let computer = connection.active else { throw PairingError("Not connected.") }
                let workspace = workspace
                if relayCommand(sent.text)?.name == "btw" { throw PairingError(asideNeedsAnswer) }
                if let through = sent.throughDraft {
                    // Started on the computer with a screenshot or a branch of its own: it starts it.
                    let chatId = try await connection.start(
                        in: projectId ?? "", workspace: workspace, sent.text, images: sent.images, files: sent.files,
                        with: sent.settings, sendAt: sent.sendAt, throughDraft: through, id: sent.id, on: computer)
                    if connection.active == computer { started(chatId) }
                    return
                }
                let place = scratch ? try await scratchFolder() : projectId
                guard connection.active == computer else { throw PairingError("The computer changed. Send again on the computer you want.") }
                guard let place else { throw PairingError("Pick a project first.") }
                let at = "\(place):\(workspace ?? "")"
                let chat: CreatedChat
                if let made, made.computer == computer, made.place == at { chat = made.chat } else { chat = try await connection.createThread(in: place, workspace: workspace, on: computer) }
                made = (computer, at, chat)
                try await connection.send(
                    sent.text, images: sent.images, files: sent.files, to: chat.id, with: sent.settings, sendAt: sent.sendAt, id: sent.id, on: computer)
                made = nil
                // Titled as the computer titles it once the message is in.
                let title = sent.sendAt == nil ? promptTitle(sent.text) : chat.title ?? ""
                if connection.active == computer {
                    MadeHere.add(Made(id: chat.id, projectId: place, title: title))
                    started(chat.id)
                }
            }
        }
        .relayBackground()
        .navigationTitle("New thread")
        .usageToolbar(provider: connection.newThread?.settings.provider)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: connection.status.state) { await connection.loadNewThread(fresh: true) }
        .task(id: scratch && connection.status.state == .online) {
            if scratch && connection.status.state == .online { _ = try? await scratchFolder() }
        }
        .onAppear {
            guard !placed, connection.overview != nil else { return }
            projectId = startingWhere()
            placed = true
        }
        .onChange(of: DraftPlace(computer: connection.active, projectId: projectId), initial: true) { before, now in
            guard let computer = now.computer else { return draftKey = nil }
            let next: String
            if now.projectId == scratchWhere || now.projectId == nil {
                // A Scratchpad's draft stays on this phone: the computer keys drafts by project.
                next = "~scratch"
            } else if let opened, newDraftProject(opened) == now.projectId {
                connection.drafts.pickNewThread(computer, now.projectId!, key: opened)
                next = opened
            } else {
                next = connection.drafts.newThreadKey(computer, now.projectId!)
            }
            if let draftKey, before.computer == computer, draftKey != next {
                UnsentPhotos.move(computer, from: draftKey, to: next)
                connection.drafts.move(computer, from: draftKey, to: next)
            }
            draftKey = next
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
        let wanted = connection.project(projectId ?? "") ?? connection.listed.first.flatMap { connection.project($0.projectId) }
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
                // Toggles rather than a Picker: a menu shows a toggle's second line.
                let pick = { (id: String) in Binding(get: { projectId == id }, set: { if $0 { projectId = id } }) }
                Toggle(isOn: pick(scratchWhere)) { Label("Scratchpad", systemImage: "note.text") }
                Divider()
                ForEach(projects) { p in
                    Toggle(isOn: pick(p.id)) {
                        Text(p.name)
                        if let line = computerLine(p.computer) { Text(line) }
                    }
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
            if !scratch, let line = computerLine(project?.computer) {
                Text(line).font(.footnote).foregroundStyle(Color.secondary)
            }
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
                        Toggle(isOn: Binding(get: { workspace == w.id }, set: { if $0 { pickWorkspace(w.id, for: project) } })) {
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

private struct DraftPlace: Equatable {
    let computer: String?
    let projectId: String?
}

/// The project's open threads, under its name: one may be the place to carry on.
private struct RecentThreads: View {
    let chats: [RemoteChatSummary]
    let open: (String) -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Open here")
                .font(.caption.weight(.medium))
                .foregroundStyle(colors.muted)
                .padding(.bottom, 2)
            ForEach(chats) { chat in
                Button { open(chat.id) } label: { ThreadRow(chat: chat) }
                    .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: 420)
    }
}
