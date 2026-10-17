import RelayRemote
import SwiftUI

/// The thread list: what needs you first, then what's running, then the rest.
struct HomeView: View {
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var open

    var body: some View {
        Group {
            if connection.overview == nil {
                ComputerWaiting()
            } else {
                ActivityList { open(.thread($0)) }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if connection.outdated {
                Text("Relay on \(connection.computer?.name ?? "your computer") is older than this app. Update it there.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 6)
            }
        }
        .relayBackground()
    }
}

/// The search tab: every thread whose title or project matches, whatever the filter. Its
/// field is the tab bar's, which the tab turns into.
struct SearchTab: View {
    let query: String
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var open

    var body: some View {
        ZStack {
            if connection.overview == nil {
                ComputerWaiting()
            } else if query.trimmingCharacters(in: .whitespaces).isEmpty {
                ContentUnavailableView(
                    "Search threads", systemImage: "magnifyingglass",
                    description: Text("By title or project, settled and snoozed ones too."))
            } else {
                SearchResults(query: query) { open(.thread($0)) }
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .relayBackground()
    }
}

/// Nothing from the computer yet: why.
struct ComputerWaiting: View {
    @Environment(Connection.self) private var connection

    var body: some View {
        switch connection.status.state {
        case .online, .connecting:
            ProgressView("Connecting to \(connection.computer?.name ?? "your computer")…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .offline:
            ContentUnavailableView(
                "Can't reach \(connection.computer?.name ?? "your computer")", systemImage: "wifi.slash",
                description: Text(connection.status.detail ?? "Check that Relay is running there."))
        case .denied:
            ContentUnavailableView(
                "Pair again", systemImage: "lock",
                description: Text("Pair this phone again from Relay’s Settings → Phone on your computer."))
        }
    }
}

extension Connection {
    /// The home tabs' subtitle: which computer, and how it's doing.
    var statusLine: String {
        let name = computer?.name ?? "Relay"
        switch status.state {
        case .online: return present == true ? "\(name) · you're there" : name
        case .connecting: return "Connecting to \(name)…"
        case .offline: return "\(name) · offline"
        case .denied: return "\(name) · pair again"
        }
    }
}

/// Threads whose title or project matches what's typed.
private struct SearchResults: View {
    let query: String
    let open: (String) -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let results = connection.chats.filter {
            "\($0.title) \(connection.project($0.projectId)?.name ?? "")".lowercased().contains(needle)
        }
        List {
            Section {
                ForEach(results) { chat in
                    Button { open(chat.id) } label: {
                        ThreadRow(chat: chat, project: connection.project(chat.projectId)?.name)
                    }
                    .activityRow()
                }
                if results.isEmpty {
                    Text("No thread or project matches “\(query.trimmingCharacters(in: .whitespaces))”.")
                        .foregroundStyle(colors.muted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                        .activityRow()
                }
            } header: {
                SectionLabel(title: "Results", count: results.count)
            }
        }
        .listStyle(.plain)
    }
}
