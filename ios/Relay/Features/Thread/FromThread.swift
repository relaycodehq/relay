import SwiftUI

extension View {
    /// Another thread's agent wrote it: its name opens that thread, while the phone knows it.
    func opensSender(_ fromThread: String?) -> some View {
        modifier(OpensSender(fromThread: fromThread))
    }
}

private struct OpensSender: ViewModifier {
    let fromThread: String?
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate

    func body(content: Content) -> some View {
        if let id = fromThread, let chat = connection.chats.first(where: { $0.id == id }) {
            Button { navigate(.thread(id)) } label: { content.underline() }
                .buttonStyle(.plain)
                .accessibilityHint("Opens \(chat.title)")
        } else {
            content
        }
    }
}
