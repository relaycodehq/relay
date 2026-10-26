import RelayRemote
import SwiftUI

/// Scratchpad threads shown before "Show more", as on the desktop.
private let scratchPage = 5

/// The Projects tab (Android's ProjectsList.kt): the Scratchpad, then each folder's projects.
struct ProjectsHome: View {
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var open

    var body: some View {
        Group {
            if let overview = connection.overview {
                ProjectsList(overview: overview, open: open)
            } else {
                ComputerWaiting()
            }
        }
        .relayBackground()
    }
}

private struct ProjectsList: View {
    let overview: RemoteOverview
    let open: (Route) -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var allScratch = false

    var body: some View {
        // Ages move with the clock.
        TimelineView(.periodic(from: .now, by: 30)) { context in
            list(now: Int64(context.date.timeIntervalSince1970 * 1000))
        }
    }

    private func list(now: Int64) -> some View {
        let scratch = scratchChats(overview)
        let byProject = Dictionary(grouping: overview.listed, by: \.projectId)
        return List {
            Section {
                HStack {
                    Text("Scratchpad").fontWeight(.medium).foregroundStyle(colors.muted)
                    Spacer()
                    Button("New Scratchpad chat", systemImage: "plus") { open(.newThread(scratch: true)) }
                        .labelStyle(.iconOnly)
                        .foregroundStyle(colors.muted)
                        .disabled(connection.status.state != .online)
                }
                .font(.caption)
                .buttonStyle(.borderless)
                .labelRow(first: true)
                ForEach(allScratch ? scratch : Array(scratch.prefix(scratchPage))) { chat in
                    Button { open(.thread(chat.id)) } label: { ThreadRow(chat: chat) }
                        .activityRow()
                }
                if scratch.isEmpty {
                    Button { open(.newThread(scratch: true)) } label: {
                        ProjectRow(title: "Ask anything", line: "A chat of its own, outside your projects") {
                            Image(systemName: "note.text").foregroundStyle(colors.muted)
                        }
                    }
                    .activityRow()
                }
                if scratch.count > scratchPage {
                    Button(allScratch ? "Show less" : "Show \(scratch.count - scratchPage) more") { allScratch.toggle() }
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .padding(.vertical, 8)
                        .activityRow()
                }
            }
            ForEach(projectFolders(overview.projects), id: \.title) { folder in
                Section {
                    SectionLabel(title: folder.title, count: folder.projects.count).labelRow()
                    ForEach(folder.projects) { project in
                        Button { open(.project(project.id)) } label: {
                            ProjectRow(title: project.name, line: projectLine(byProject[project.id] ?? [], now: now, computer: project.computer)) {
                                ProjectIcon(project: project, size: 16)
                            }
                        }
                        .activityRow()
                    }
                }
            }
        }
        .listStyle(.plain)
        .labelRows()
        .ribbonRefresh { await connection.reloadList() }
    }
}

/// A project, or the Scratchpad's way in: an icon, its name and a line under it.
struct ProjectRow<Icon: View>: View {
    let title: String
    let line: String
    @ViewBuilder let icon: Icon
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 12) {
            icon.font(.system(size: 15)).frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(colors.foreground).lineLimit(1)
                Text(line).font(.footnote).foregroundStyle(colors.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 9)
        .contentShape(.rect)
    }
}
