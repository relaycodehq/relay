import RelayRemote
import SwiftUI

/// The thread list: what needs you first, then what's running, then the rest; while
/// something's typed in the search, every thread that matches, whatever the filter.
struct HomeView: View {
    let query: String
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var open

    var body: some View {
        Group {
            if connection.overview == nil {
                ComputerWaiting()
            } else if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                SearchResults(query: query) { open(.thread($0)) }
            } else {
                ActivityList { open(.thread($0)) }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { ComputerUpdateBanner() }
        .relayBackground()
    }
}

/// Nothing from the computer yet: why.
struct ComputerWaiting: View {
    @Environment(Connection.self) private var connection

    var body: some View {
        switch connection.status.state {
        case .online, .connecting:
            VStack(spacing: 12) {
                Spinner(size: 26)
                Text("Connecting to \(connection.computer?.name ?? "your computer")…").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .offline:
            ContentUnavailableView(
                "Can't reach \(connection.computer?.name ?? "your computer")", systemImage: "wifi.slash",
                description: Text(connection.status.detail ?? "Check that Relay is running there."))
        case .denied:
            ContentUnavailableView {
                Label("Pair again", systemImage: "lock")
            } description: {
                Text("Pair this phone again from Relay’s Settings → Phone on your computer.")
            } actions: {
                // The old pairing is no use any more; forgetting it opens pairing.
                Button("Pair again") { if let key = connection.active { connection.forget(key) } }
                    .buttonStyle(.accentGlass)
            }
        }
    }
}

extension Connection {
    /// The home tabs' subtitle: which computer, and how it's doing.
    var statusLine: String {
        let name = computer?.name ?? "Relay"
        switch status.state {
        case .online: return present == true ? "\(name) · you're there" : name
        case .connecting: return failing ? "\(name) · offline" : "Connecting to \(name)…"
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
        let results = connection.listed.filter {
            "\($0.title) \(connection.project($0.projectId)?.name ?? "")".lowercased().contains(needle)
        }
        List {
            Section {
                SectionLabel(title: "Results", count: results.count).labelRow(first: true)
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
            }
        }
        .listStyle(.plain)
        .labelRows()
    }
}
