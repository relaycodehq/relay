import RelayRemote
import SwiftUI

/// A project: its checkout at a glance, its screens, and every thread in it (Android's ProjectScreen.kt).
struct ProjectView: View {
    let projectId: String
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors
    @State private var glance: ProjectGlance?

    private var project: RemoteProject? { connection.project(projectId) }
    private var git: Bool { project != nil && project?.plain != true }
    private var online: Bool { connection.status.state == .online }

    var body: some View {
        let chats = connection.chats.filter { $0.projectId == projectId }
        let tree = glance?.tree
        List {
            Section {
                EntryRow(icon: "plus", tint: colors.accent, title: "New thread") {
                    navigate(.newThread(projectId: projectId))
                }
                .disabled(!online)
                if git {
                    EntryRow(icon: "plusminus", title: "Changes", subtitle: tree.map(changesLine)) {
                        navigate(.git(.changes(where: projectId)))
                    }
                    EntryRow(
                        icon: "arrow.triangle.branch", title: tree.flatMap { $0.branch.isEmpty ? nil : $0.branch } ?? "Branch",
                        subtitle: tree?.operation.map(operationInProgress) ?? "Switch or create a branch"
                    ) {
                        navigate(.git(.branches(projectId: projectId)))
                    }
                }
                EntryRow(icon: "doc.text", title: "Files") { navigate(.files(place: projectId)) }
                if git {
                    EntryRow(icon: "clock.arrow.circlepath", title: "History") { navigate(.git(.history(where: projectId))) }
                }
                EntryRow(
                    icon: "terminal", title: "Tasks",
                    subtitle: glance?.tasks.map { $0 > 0 ? "\($0) running" : "Nothing running" }
                ) {
                    navigate(.tasks(projectId: projectId))
                }
                if connection.canTunnel {
                    let ports = glance?.ports ?? []
                    EntryRow(
                        icon: "globe", title: "Sites",
                        subtitle: ports.isEmpty
                            ? "Open localhost on \(connection.overview?.name ?? "the computer")"
                            : ports.map { "localhost:\($0)" }.joined(separator: ", ")
                    ) {
                        navigate(.browser(url: ports.count == 1 ? SiteAddress(port: ports[0]).href : nil))
                    }
                }
            }
            Section {
                SectionLabel(title: "Threads", count: chats.count).labelRow()
                ForEach(chats) { chat in
                    Button { navigate(.thread(chat.id)) } label: { ThreadRow(chat: chat) }
                        .activityRow()
                }
                if chats.isEmpty {
                    Text("No threads in this project yet.")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .padding(.vertical, 12)
                        .activityRow()
                }
            }
        }
        .listStyle(.plain)
        .ribbonRefresh {
            async let list: Void = connection.reloadList()
            async let look: Void = load()
            _ = await (list, look)
        }
        .relayBackground()
        .navigationTitle(project?.name ?? "Project")
        .navigationBarTitleDisplayMode(.inline)
        // Fresh each time the screen shows again, e.g. after a commit on the screen above it.
        .task(id: online) { await load() }
    }

    private func load() async {
        guard online, let client = try? connection.liveClient() else { return }
        glance = await ProjectGlance.of(client, projectId: projectId, git: git)
    }
}

/// The working tree (git projects only) and what runs; a half that fails is left out.
struct ProjectGlance: Equatable {
    var tree: WorkingTreeGlance?
    var tasks: Int?
    var ports: [Int] = []

    static func of(_ client: RemoteClient, projectId: String, git: Bool) async -> ProjectGlance {
        async let tree = git ? try? client.workingTreeGlance(where: projectId) : nil
        async let tasks = try? client.projectTasks(projectId: projectId)
        let running = await tasks
        return ProjectGlance(
            tree: await tree, tasks: running?.count, ports: Array(Set((running ?? []).flatMap(\.ports))).sorted())
    }
}
