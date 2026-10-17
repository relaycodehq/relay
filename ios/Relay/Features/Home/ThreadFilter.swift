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
    @Environment(ProjectIconStore.self) private var icons
    @Environment(\.colors) private var colors
    @Environment(\.displayScale) private var scale

    var body: some View {
        let shown = connection.current(filter)
        let agents = Set(connection.chats.compactMap(\.provider)).sorted { agentName($0) < agentName($1) }
        let latest = Dictionary(connection.chats.map { ($0.projectId, $0.updated) }, uniquingKeysWith: max)
        let sorted = (connection.overview?.projects ?? []).sorted { (latest[$0.id] ?? 0) > (latest[$1.id] ?? 0) }
        // Every computer's Scratchpad reads the same, so they're one row that ticks them all.
        let scratch = sorted.filter { $0.scratch == true }.map(\.id)
        let projects = sorted.filter { $0.scratch != true || $0.id == scratch.first }
        Menu {
            // Always there, off with nothing to clear, so ticking the first row doesn't move the rest.
            Button("Clear filter", systemImage: "xmark") { filter = ThreadFilter() }
                .disabled(shown.count == 0)
            if agents.count > 1 {
                Section("Agents") {
                    ForEach(agents, id: \.self) { agent in
                        row(agentName(agent), ticked(\.agents, [agent])) {
                            ProviderMark(provider: agent, size: 18).foregroundStyle(colors.foreground)
                        }
                    }
                }
            }
            Section("Projects") {
                ForEach(projects) { project in
                    row(project.scratch == true ? "Scratchpad" : project.name, ticked(\.projects, project.scratch == true ? scratch : [project.id])) {
                        ProjectIcon(project: project, size: 18).environment(connection).environment(icons).environment(\.colors, colors)
                    }
                }
            }
        } label: {
            Label(shown.count > 0 ? "Filter, \(shown.count) applied" : "Filter", systemImage: "line.3.horizontal.decrease")
        }
    }

    private func ticked(_ kind: WritableKeyPath<ThreadFilter, Set<String>>, _ ids: [String]) -> Binding<Bool> {
        Binding(
            get: { ids.contains { filter[keyPath: kind].contains($0) } },
            set: { on in
                if on { filter[keyPath: kind].formUnion(ids) } else { filter[keyPath: kind].subtract(ids) }
            })
    }

    /// A row that ticks on and off, its tick after the name: a menu's own checkmark takes a column
    /// before every row once one is on, which shoved the whole list over at the first tick.
    private func row(_ name: String, _ on: Binding<Bool>, @ViewBuilder mark: () -> some View) -> some View {
        Button { on.wrappedValue.toggle() } label: {
            Label {
                Text(on.wrappedValue ? "\(name)  ✓" : name)
            } icon: { icon(mark()) }
        }
        .accessibilityAddTraits(on.wrappedValue ? .isSelected : [])
        // Several can be ticked in one go, as on the desktop.
        .menuActionDismissBehavior(.disabled)
    }

    /// A menu row shows only an Image, so a mark drawn as a view is rendered into one.
    private func icon(_ view: some View) -> Image {
        let renderer = ImageRenderer(content: view)
        renderer.scale = scale
        return renderer.uiImage.map { Image(uiImage: $0).renderingMode(.original) } ?? Image(systemName: "circle")
    }
}
