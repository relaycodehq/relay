import RelayRemote
import SwiftUI

// What an answer leaves for the user besides its text: why it failed, and a
// login to renew.

/// The desktop's AgentError: the provider's message out of its envelope, the envelope on request.
struct AgentErrorNote: View {
    let error: String
    @Environment(\.colors) private var colors
    @State private var open = false

    var body: some View {
        let shown = agentError(error)
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(colors.destructive)
            VStack(alignment: .leading, spacing: 4) {
                Text(shown.message).selectsOnHold(shown.message)
                if let hint = shown.hint {
                    Text(hint).font(.caption).foregroundStyle(colors.muted)
                }
                if let details = shown.details {
                    Button(open ? "Hide technical details" : "Technical details") {
                        withAnimation(.snappy(duration: 0.2)) { open.toggle() }
                    }
                    .font(.caption)
                    .foregroundStyle(colors.muted)
                    .buttonStyle(.plain)
                    if open {
                        Text(String(details.prefix(4000)))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(colors.muted)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(colors.code, in: .rect(cornerRadius: 8))
                            .selectsOnHold(details, mono: true)
                    }
                }
            }
        }
        .font(.subheadline)
    }
}

/// The desktop offers to sign in again; that needs its terminal or browser, so the phone only says so.
struct SignInNote: View {
    let provider: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            Image(systemName: "person.crop.circle.badge.exclamationmark").foregroundStyle(colors.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(agentName(provider)) is signed out").font(.subheadline.weight(.semibold))
                Text("Open this thread on \(connection.overview?.name ?? "your computer") to sign in again, then resume the answer.")
                    .font(.caption)
                    .foregroundStyle(colors.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(colors.border) }
    }
}
