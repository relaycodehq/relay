import RelayRemote
import SwiftUI

/// What the sheet says under each computer (Android's ComputerLines, mobile/src/ui/ComputerSwitch.tsx).
struct ComputerLines {
    let computers: [RemoteCredentials]
    let active: String?
    let status: RemoteStatus
    let version: String?
    let reached: [String: Int64]
    let now: Int64

    /// Where the phone reaches it, to tell apart pairings that share a name.
    static func address(_ c: RemoteCredentials) -> String {
        "\(Routes.order(c.hosts, routes: c.routes ?? Routes.defaultOrder).first ?? "?"):\(c.port)"
    }

    func lastReached(_ c: RemoteCredentials) -> String {
        reached[c.key].map { "Last reached \(ago($0, now: now))" } ?? "Not reached lately"
    }

    func status(_ c: RemoteCredentials) -> String {
        guard c.key == active else { return lastReached(c) }
        switch status.state {
        case .online: return version.map { "Connected · Relay \($0)" } ?? "Connected"
        case .connecting: return "Connecting…"
        case .denied: return "Turned this phone away"
        case .offline: return "Can't reach it right now · \(lastReached(c))"
        }
    }

    /// Paired again at the same name and address since: Relay there has a new key, this one is dead.
    func replaced(_ c: RemoteCredentials) -> Bool {
        guard let at = computers.firstIndex(where: { $0.key == c.key }) else { return false }
        return computers[(at + 1)...].contains { $0.name == c.name && Self.address($0) == Self.address(c) }
    }

    func hint(_ c: RemoteCredentials) -> String {
        if c.key != active && replaced(c) { return "Paired again since · \(lastReached(c))" }
        // Pairings that share a name, e.g. the same computer paired again, say where they point.
        return computers.contains { $0.key != c.key && $0.name == c.name } ? "\(status(c)) · \(Self.address(c))" : status(c)
    }

    func forgetMessage(_ c: RemoteCredentials) -> String {
        replaced(c)
            ? "This phone paired with it again since, so this older pairing can't connect."
            : "\(lastReached(c)). Pairing again needs a new code from Relay there."
    }
}

/// The paired computers to switch to, and pairing another; the phone talks to one at a time.
struct ComputerSheet: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @Environment(ComputerUpdates.self) private var updates
    @State private var forgetting: RemoteCredentials?
    @State private var pairing = false
    /// The list's own height, so the sheet opens as tall as its rows instead of at half the screen.
    @State private var listHeight: CGFloat = 0

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                let lines = ComputerLines(
                    computers: connection.computers, active: connection.active, status: connection.status,
                    version: connection.overview?.version, reached: connection.reached, now: nowMs())
                List {
                    Section {
                        ForEach(connection.computers, id: \.key) { computer in
                            row(computer, lines)
                        }
                    }
                    Section {
                        updateRow
                        Button {
                            pairing = true
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Pair another computer").foregroundStyle(colors.foreground)
                                    Text("Scan the code in Relay’s Settings → Phone there.")
                                        .font(.footnote)
                                        .foregroundStyle(colors.muted)
                                }
                            } icon: {
                                Image(systemName: "plus").foregroundStyle(colors.foreground)
                            }
                        }
                    }
                }
                .listSectionSpacing(.compact)
                .contentMargins(.top, 8, for: .scrollContent)
                .onScrollGeometryChange(for: CGFloat.self, of: { $0.contentSize.height + $0.contentInsets.top + $0.contentInsets.bottom }) {
                    listHeight = $1
                }
                .confirmationDialog(
                    "Forget \(forgetting?.name ?? "")?", isPresented: forgettingShown, titleVisibility: .visible,
                    presenting: forgetting
                ) { computer in
                    Button("Forget", role: .destructive) { connection.forget(computer.key) }
                } message: { computer in
                    Text(lines.forgetMessage(computer))
                }
            }
            .navigationTitle("Computers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        .presentationDetents(listHeight > 0 ? [.height(listHeight), .large] : [.medium, .large])
        .fullScreenCover(isPresented: $pairing) { PairingView() }
    }

    /// Updating the one in use, while its banner hasn't started that.
    @ViewBuilder private var updateRow: some View {
        let action = connection.updateAction(updates)
        if action.can && action.update == nil {
            Button {
                dismiss()
                connection.startUpdate(updates)
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Update \(connection.computerName)").foregroundStyle(colors.foreground)
                        Text("\(action.hint) It restarts into the new version; its agents keep going.")
                            .font(.footnote)
                            .foregroundStyle(colors.muted)
                    }
                } icon: {
                    Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(colors.foreground)
                }
            }
        }
    }

    private var forgettingShown: Binding<Bool> {
        Binding(get: { forgetting != nil }, set: { if !$0 { forgetting = nil } })
    }

    private func row(_ computer: RemoteCredentials, _ lines: ComputerLines) -> some View {
        let here = computer.key == connection.active
        return Button {
            dismiss()
            if !here { connection.switchTo(computer.key) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "desktopcomputer")
                    .foregroundStyle(here ? colors.accent : colors.muted)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(computer.name).foregroundStyle(colors.foreground)
                    Text(lines.hint(computer))
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                if here {
                    Image(systemName: "checkmark")
                        .foregroundStyle(colors.accent)
                        .accessibilityLabel("Current")
                }
            }
        }
        .swipeActions {
            if !here {
                Button("Forget", role: .destructive) { forgetting = computer }
            }
        }
        .contextMenu {
            if !here {
                Button("Forget", systemImage: "trash", role: .destructive) { forgetting = computer }
            }
        }
    }
}
