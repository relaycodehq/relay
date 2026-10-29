import SwiftUI

/// A folded turn's steps on their way from the computer; a failed fetch offers another go.
struct StepsComing: View {
    let chatId: String
    let messageId: String
    @Environment(Connection.self) private var connection
    @Environment(\.unfold) private var unfold
    @State private var attempt = 0
    @State private var failed = false

    var body: some View {
        Group {
            if failed {
                Button("Couldn't load the steps. Tap to try again.") {
                    failed = false
                    attempt += 1
                }
                .buttonStyle(.plain)
            } else {
                HStack(spacing: 6) {
                    Spinner(size: 13)
                    Text("Loading steps")
                }
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .task(id: attempt) { failed = !(await connection.loadSteps(chatId, message: messageId, unfold: unfold)) }
    }
}
