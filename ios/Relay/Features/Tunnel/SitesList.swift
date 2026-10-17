import RelayRemote
import SwiftUI

/// "Vite dev server · Relay · in a worktree".
func siteLine(_ site: RemoteSite) -> String {
    [site.title, site.project, site.worktree ? "in a worktree" : nil].compactMap { $0 }.joined(separator: " · ")
}

/// Sites that match what's typed, when it isn't an address of its own.
func matching(_ sites: [RemoteSite], _ typed: String) -> [RemoteSite] {
    var q = typed.trimmingCharacters(in: .whitespaces).lowercased()
    for prefix in ["http://", "localhost", ":"] where q.hasPrefix(prefix) { q.removeFirst(prefix.count) }
    if q.isEmpty { return sites }
    return sites.filter { s in
        String(s.port).hasPrefix(q) || [s.title, s.project, s.command].contains { $0.lowercased().contains(q) }
    }
}

/// What runs on the computer's localhost, looked at again every few seconds, with what's
/// typed on top when it reads as an address there.
struct SitesList: View {
    let name: String
    let typed: String
    let open: (SiteAddress) -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var list: [RemoteSite]?
    @State private var error: String?

    var body: some View {
        let address = LocalUrls.typed(typed)
        let shown = list.map { address != nil ? $0 : matching($0, typed) }
        List {
            if let address {
                Section {
                    row(icon: "arrow.right", tint: colors.accent, "Open \(address.shown)") { open(address) }
                }
            }
            Section {
                if let shown, !shown.isEmpty {
                    ForEach(shown) { site in
                        row(icon: "globe", tint: colors.muted, "localhost:\(site.port)", subtitle: siteLine(site)) {
                            open(SiteAddress(port: site.port))
                        }
                    }
                } else if let shown {
                    note(
                        shown.count == list?.count
                            ? "Nothing in your projects listens on a port right now. Type one to open it anyway."
                            : "No running site matches.")
                } else if let error {
                    note("Couldn't see what runs there: \(error)")
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12).activityRow()
                }
            } header: {
                SectionLabel(title: "Running on \(name)", count: shown?.count ?? 0)
            }
        }
        .listStyle(.plain)
        .scrollDismissesKeyboard(.immediately)
        .relayBackground()
        .task(id: connection.status.state == .online) {
            guard connection.status.state == .online else { return }
            while !Task.isCancelled {
                do {
                    list = try await connection.sites()
                    error = nil
                } catch is CancellationError {
                    return
                } catch {
                    self.error = error.localizedDescription
                }
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    private func row(icon: String, tint: Color, _ title: String, subtitle: String? = nil, action: @escaping () -> Void)
        -> some View
    {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).foregroundStyle(tint).frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(.body, design: .monospaced)).foregroundStyle(colors.foreground)
                    if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(colors.muted) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(colors.faint)
            }
            .padding(.vertical, 10)
            .contentShape(.rect)
        }
        .activityRow()
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundStyle(colors.muted).padding(.vertical, 12).activityRow()
    }
}
