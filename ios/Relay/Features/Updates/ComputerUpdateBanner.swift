import RelayRemote
import SwiftUI

/// The computer in use is behind this phone: a button to update it, then how that goes
/// (Android's ComputerUpdateBanner). Home floats it over the bottom of its list, a glass bar
/// as tall as the tab bar under it.
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
                    "Update \(name)",
                    message: connection.overview?.version.map { "Relay \($0) → \(Connection.appVersion)" }
                        ?? "Its agents keep going",
                    icon: "arrow.triangle.2.circlepath", tone: colors.foreground,
                    act: ("Update", { connection.startUpdate(updates) }), dismiss: dismiss)
            } else if connection.outdated {
                banner(
                    "Relay on \(name) is older than this app", message: "Update it there.",
                    icon: "exclamationmark.triangle", tone: colors.foreground, dismiss: nil)
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
        HStack(spacing: 12) {
            if let icon { Image(systemName: icon).font(.body.weight(.medium)).foregroundStyle(tone) }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(tone)
                if let message { Text(message).font(.caption).foregroundStyle(colors.muted) }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            Spacer(minLength: 0)
            if let act {
                Button(act.0, action: act.1).buttonStyle(.accentGlass).font(.subheadline)
            }
            if let dismiss {
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.footnote.weight(.semibold)).frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .foregroundStyle(colors.muted)
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, act == nil ? 14 : 10)
        // The tab bar's own height, so the two read as a pair.
        .frame(height: 62)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
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
