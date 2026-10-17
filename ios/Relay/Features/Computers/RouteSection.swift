import RelayRemote
import SwiftUI

/// Local network or Tailscale first, and which one carries the link now.
struct RouteSection: View {
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    private static let choices: [(kind: RouteKind, label: String, hint: String)] = [
        (.local, "Local network first", "Straight to it on the same Wi-Fi; Tailscale when that doesn’t answer."),
        (.tailscale, "Tailscale first", "Over Tailscale; the local network only when Tailscale doesn’t answer."),
    ]

    var body: some View {
        if let computer = connection.computer {
            let first = connection.routes.first ?? .local
            Section("Reaching \(computer.name)") {
                ForEach(Self.choices, id: \.kind) { choice in
                    Button {
                        connection.setRoutes(choice.kind == .local ? [.local, .tailscale] : [.tailscale, .local])
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(choice.label).foregroundStyle(colors.foreground)
                                Text(
                                    connection.route?.kind == choice.kind
                                        ? "Connected this way now, at \(connection.route!.host)." : choice.hint
                                )
                                .font(.footnote)
                                .foregroundStyle(colors.muted)
                            }
                            Spacer()
                            if first == choice.kind {
                                Image(systemName: "checkmark").foregroundStyle(colors.accent)
                            }
                        }
                    }
                }
            }
        }
    }
}
