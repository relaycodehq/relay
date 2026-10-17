import RelayRemote
import SwiftUI

/// What the line says for a status, or nil when it stays quiet. `tailnet`: the computer has an
/// address on Tailscale, which this phone can't see is on, so it says to check.
func connectionText(_ status: RemoteStatus, name: String, tailnet: Bool) -> String? {
    switch status.state {
    case .online: return nil
    case .connecting: return "Connecting to \(name)…"
    case .denied: return status.detail ?? "\(name) turned this phone away."
    case .offline:
        let why = status.detail ?? "Can't reach \(name)."
        return tailnet ? "\(why) Retrying… Is Tailscale on here?" : "\(why) Retrying…"
    }
}

extension View {
    /// Which computer this is, and whether it's reachable, under the bar; quiet when all is well.
    func connectionLine() -> some View { modifier(ConnectionLineHost()) }
}

private struct ConnectionLineHost: ViewModifier {
    @Environment(Connection.self) private var connection

    func body(content: Content) -> some View {
        // Nothing listed yet says why itself, in full.
        if connection.paired && connection.overview != nil {
            content.safeAreaBar(edge: .top) { ConnectionLine() }
        } else {
            content
        }
    }
}

/// Unreached, it offers what would help: trying again now, or scanning the code again where only
/// the address the pairing learned can reach it, which moving to another network changes.
struct ConnectionLine: View {
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    /// Each retry passes through Connecting; once an attempt failed, the line keeps saying what
    /// failed until the computer is reached, so it doesn't flicker.
    @State private var failure: RemoteStatus?
    @State private var pairing = false

    var body: some View {
        let live = connection.status
        let status = live.state == .connecting ? failure ?? live : live
        let tailnet = connection.computer?.hosts.contains { Routes.kind($0) == .tailscale } == true
        let name = connection.computer?.name ?? "your computer"
        Group {
            if let text = connectionText(status, name: name, tailnet: tailnet) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(status.state == .denied ? colors.destructive : colors.muted)
                        .frame(width: 7, height: 7)
                    Text(text)
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if status.state == .offline {
                        if tailnet {
                            Button("Try now") { connection.wake() }
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(colors.accent)
                        } else {
                            Button("Scan code again") { pairing = true }
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(colors.accent)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 6)
                // Two lines' room whatever it says, so "Connecting…" turning into a longer
                // "Can't reach…" doesn't move what's under it.
                .frame(minHeight: 44)
                .accessibilityElement(children: .combine)
            }
        }
        .onChange(of: live, initial: true) { _, now in
            switch now.state {
            case .offline: failure = now
            case .online, .denied: failure = nil
            case .connecting: break
            }
        }
        .fullScreenCover(isPresented: $pairing) { PairingView() }
    }
}
