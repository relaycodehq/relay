import SwiftUI

/// Where Relay opens after a crash (CrashRecovery): what broke, and the way on.
struct CrashScreen: View {
    let crash: Crash
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        ContentUnavailableView {
            Label("Relay hit a bug", systemImage: "ladybug")
        } description: {
            Text("It closed last time because of this:\n") + Text(crash.summary).font(.mono(.footnote))
        } actions: {
            Button("Back to Home") { dismiss() }
                .buttonStyle(.accentGlass)
            Button(copied ? "Copied" : "Copy details") {
                UIPasteboard.general.string = crash.details
                copied = true
            }
            .font(.subheadline)
        }
        .padding(.horizontal, 24)
        .relayBackground()
    }
}
