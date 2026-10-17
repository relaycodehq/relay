import RelayRemote
import SwiftUI

/// Narrows the thread list to some projects or agents, as the desktop's sidebar filter does.
struct ThreadFilter: Codable, Equatable {
    var projects: Set<String> = []
    var agents: Set<String> = []

    var count: Int { projects.count + agents.count }

    func keeps(_ chat: RemoteChatSummary) -> Bool {
        (projects.isEmpty || projects.contains(chat.projectId))
            && (agents.isEmpty || agents.contains(chat.provider ?? ""))
    }

    /// What's ticked of what's still there: a removed project or an agent no thread ran
    /// anymore would otherwise hide every thread.
    func current(projects there: Set<String>, agents ran: Set<String>) -> ThreadFilter {
        ThreadFilter(projects: projects.intersection(there), agents: agents.intersection(ran))
    }
}

extension EnvironmentValues {
    @Entry var threadFilter = ThreadFilter()
}

extension Connection {
    /// The filter as it applies to what the computer has now.
    func current(_ filter: ThreadFilter) -> ThreadFilter {
        filter.current(
            projects: Set(overview?.projects.map(\.id) ?? []), agents: Set(chats.compactMap(\.provider)))
    }
}

/// The filter's menu: agents once threads ran more than one, since a single agent filters
/// nothing, then projects, latest activity first.
struct FilterMenu: View {
    @Binding var filter: ThreadFilter
    @Environment(Connection.self) private var connection

    var body: some View {
        let shown = connection.current(filter)
        let agents = Set(connection.chats.compactMap(\.provider)).sorted { agentName($0) < agentName($1) }
        let latest = Dictionary(connection.chats.map { ($0.projectId, $0.updated) }, uniquingKeysWith: max)
        let projects = (connection.overview?.projects ?? []).sorted { (latest[$0.id] ?? 0) > (latest[$1.id] ?? 0) }
        Menu {
            if shown.count > 0 {
                Button("Clear filter", systemImage: "xmark") { filter = ThreadFilter() }
            }
            if agents.count > 1 {
                Section("Agents") {
                    ForEach(agents, id: \.self) { agent in
                        Toggle(agentName(agent), isOn: ticked(\.agents, agent))
                            .menuActionDismissBehavior(.disabled)
                    }
                }
            }
            Section("Projects") {
                ForEach(projects) { project in
                    Toggle(project.scratch == true ? "Scratchpad" : project.name, isOn: ticked(\.projects, project.id))
                        // Several can be ticked in one go, as on the desktop.
                        .menuActionDismissBehavior(.disabled)
                }
            }
        } label: {
            Label(shown.count > 0 ? "Filter, \(shown.count) applied" : "Filter", systemImage: "line.3.horizontal.decrease")
        }
    }

    private func ticked(_ kind: WritableKeyPath<ThreadFilter, Set<String>>, _ id: String) -> Binding<Bool> {
        Binding(
            get: { filter[keyPath: kind].contains(id) },
            set: { on in
                if on { filter[keyPath: kind].insert(id) } else { filter[keyPath: kind].remove(id) }
            })
    }
}
