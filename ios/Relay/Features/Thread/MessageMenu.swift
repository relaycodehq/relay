import RelayRemote
import SwiftUI
import UIKit

extension EnvironmentValues {
    /// Puts a quote of a message after what the thread's composer holds; nil where there's no composer.
    @Entry var quoteMessage: ((String) -> Void)?
}

/// A message's text as it reads, without the `@agent` a send leads with.
func readText(_ m: ChatMessage) -> String { m.role == "user" ? withoutAgentMention(m.body) : m.body }

/// The Quote item: the start of the message, into your reply.
struct QuoteItem: View {
    let text: String
    @Environment(\.quoteMessage) private var quote

    var body: some View {
        if let quote, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Button {
                quote(quoteMarkdown(quoteExcerpt(text)))
            } label: {
                Label("Quote", systemImage: "text.quote")
                Text("The start of this message, into your reply")
            }
        }
    }
}

/// Your message's actions, beside its time: its text selects on a hold, so the menu can't live there.
struct UserMessageMenu: View {
    let chatId: String
    let message: ChatMessage
    /// On the main conversation, where it can be replied to.
    let replies: Bool
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors

    var body: some View {
        let text = readText(message)
        Menu {
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
            if replies {
                Button {
                    navigate(.replies(chatId: chatId, rootId: message.id))
                } label: {
                    Label("Reply", systemImage: "arrowshape.turn.up.left")
                    Text("A side conversation that leaves this one as it is.")
                }
            }
            QuoteItem(text: text)
            if !text.isEmpty { ShareLink(item: text) }
        } label: {
            Image(systemName: "ellipsis")
                .font(.caption)
                .foregroundStyle(colors.faint)
                .frame(width: 28, height: 20)
                .contentShape(.rect)
        }
        .accessibilityLabel("More for this message")
    }
}
