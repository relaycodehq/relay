import RelayRemote
import SwiftUI

/// The computer in use is behind this phone: a button to update it, then how that goes
/// (Android's ComputerUpdateBanner). Home shows it over its list.
struct ComputerUpdateBanner: View {
    @Environment(Connection.self) private var connection
    @Environment(ComputerUpdates.self) private var updates
    @Environment(\.colors) private var colors

    var body: some View {
        let action = connection.updateAction(updates)
        let name = connection.computerName
        Group {
            if let update = action.update {
                let done = !update.underWay
                banner(
                    describeUpdate(name, update), icon: done ? nil : "arrow.triangle.2.circlepath",
                    tone: update.isError ? colors.destructive : update == .latest ? colors.additionText : colors.foreground,
                    dismiss: done ? { dismiss() } : nil)
            } else if action.needed && !action.dismissed && !action.askable {
                // An older bridge can't be asked; once it's updated by hand, it can.
                banner(
                    "Update Relay on \(name)",
                    message: "To use everything on this phone. After this once, the phone can update it for you.",
                    icon: "exclamationmark.triangle", tone: colors.waiting, dismiss: dismiss)
            } else if action.can && !action.dismissed {
                banner(
                    action.hint, message: "Update \(name) from here; its agents keep going.",
                    icon: "arrow.triangle.2.circlepath", tone: colors.foreground,
                    act: ("Update", { connection.startUpdate(updates) }), dismiss: dismiss)
            } else if connection.outdated {
                Text("Relay on \(name) is older than this app. Update it there.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 6)
            }
        }
        .task(id: ProbeWant(connection, needed: action.needed && action.askable)) {
            guard action.needed && action.askable, let active = connection.active else { return }
            await updates.probe(active, connection)
        }
        .onChange(of: connection.overview?.version) { _, running in
            if let active = connection.active { updates.cameBack(active, running: running) }
        }
    }

    private func dismiss() {
        if let active = connection.active { updates.dismiss(active, running: connection.overview?.version) }
    }

    private func banner(
        _ title: String, message: String? = nil, icon: String?, tone: Color,
        act: (String, () -> Void)? = nil, dismiss: (() -> Void)?
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if let icon { Image(systemName: icon).foregroundStyle(tone).padding(.top, 2) }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(tone)
                if let message { Text(message).font(.footnote).foregroundStyle(colors.muted) }
                if let act {
                    Button(act.0, action: act.1).buttonStyle(.glassProminent).controlSize(.small).padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
            if let dismiss {
                Button(action: dismiss) { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
                    .font(.footnote)
                    .foregroundStyle(colors.muted)
                    .accessibilityLabel("Dismiss")
            }
        }
        .padding(12)
        .background(colors.card, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(colors.border, lineWidth: 0.5))
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }
}

private struct ProbeWant: Equatable {
    let active: String?
    let online: Bool
    let needed: Bool

    init(_ connection: Connection, needed: Bool) {
        active = connection.active
        online = connection.status.state == .online
        self.needed = needed
    }
}

extension ComputerUpdate {
    var isError: Bool { if case .error = self { true } else { false } }
}
