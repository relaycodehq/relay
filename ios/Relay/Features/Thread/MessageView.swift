import RelayMarkdown
import RelayRemote
import SwiftUI

/// One message as Android and the desktop show it: yours as a bubble on the
/// right with its time, the agent's under its name with what it did, the
/// files it changed and its actions; compactions, handoffs and setup as a
/// line across the thread.
struct MessageView: View {
    let chatId: String
    let message: ChatMessage
    var root: String?
    /// Replies under it, shown as a link to its side conversation.
    var replies = 0
    /// On the main conversation, where a message can be replied to.
    var main = true
    @Environment(\.colors) private var colors
    @Environment(\.navigate) private var navigate
    /// Read pictures show under their calls while the trace is open, in the row under it otherwise.
    @State private var traceOpen = false

    private var images: MessageImages { MessageImages(chatId: chatId, message: message, root: root) }

    var body: some View {
        let m = message
        if m.handedOver == true {
            // Relay's own prompt that starts a handed-over thread here; the "Continued on" row stands for it.
            EmptyView()
        } else if let handoff = m.handoff {
            HandoffRow(message: m, handoff: handoff)
        } else if let run = m.worktreeCommand {
            WorktreeCommandRow(chatId: chatId, message: m, run: run, main: main)
        } else if m.role == "user", let page = m.pageAnswer {
            StatusRow(
                page.skipped == true
                    ? "You skipped “\(page.title)” and left it to the agent" : "You answered “\(page.title)”")
        } else if let reload = m.reload {
            StatusRow(reloadNote(reload, live: m.streaming))
        } else if m.compaction == true {
            CompactionRow(message: m)
        } else if m.role == "user" {
            mine
        } else {
            answer
        }
    }

    private var mine: some View {
        let text = withoutAgentMention(message.body)
        let images = images
        return VStack(alignment: .trailing, spacing: 6) {
            if message.author != nil || message.unprompted == true {
                byline(message.author ?? "You").opensSender(message.fromThread)
            }
            // Above what you wrote, as on the desktop.
            if !images.strip.isEmpty {
                MessageImageRow(images: images.strip, among: images.all)
            }
            // A screenshot sent on its own leaves nothing for the bubble to hold.
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                HStack {
                    Spacer(minLength: 56)
                    SelectableText(text: AttributedString(text), look: TextLook(color: colors.foreground))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background {
                            // A /btw question: a dashed outline and nothing else, as on the desktop.
                            if message.side == true {
                                RoundedRectangle(cornerRadius: 18)
                                    .strokeBorder(colors.muted, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            } else {
                                RoundedRectangle(cornerRadius: 18).fill(colors.fill)
                            }
                        }
                        .opacity(message.pending == true ? 0.6 : 1)
                }
            }
            HStack(spacing: 2) {
                Text(message.pending == true && message.error == nil ? "Sending…" : Clock().clock(message.created))
                    .font(.caption)
                    .foregroundStyle(colors.faint)
                if message.pending != true { UserMessageMenu(chatId: chatId, message: message, replies: main) }
            }
            repliesLink
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var answer: some View {
        let images = images
        let strip = traceOpen ? images.pasted : images.strip
        return VStack(alignment: .leading, spacing: 10) {
            byline(agentName(message.provider), mark: message.provider)
            if message.streaming || !Turn(message).shown.isEmpty {
                TurnTrace(chatId: chatId, message: message, root: root, looked: images.looked) { traceOpen = $0 }
            }
            if !startCalls(message).isEmpty {
                StartedInTurn(chatId: chatId, message: message)
            }
            if let renders = message.renders {
                MessageRenders(chatId: chatId, renders: renders)
            }
            if !message.body.isEmpty {
                MarkdownView(message.body)
                    .environment(\.markdownImage, answerImage(among: images.all))
            }
            if let preview = message.preview, !message.streaming {
                TurnPreviewCard(chatId: chatId, messageId: message.id, preview: preview)
            }
            if !strip.isEmpty {
                MessageImageRow(images: strip, among: images.all)
            }
            AsyncQuestions(chatId: chatId, message: message)
            WatchNotesView(chatId: chatId, message: message)
            if let changes = message.changes, !changes.isEmpty, !message.streaming {
                ChangedFiles(chatId: chatId, message: message, files: changes)
            }
            if message.status == "cancelled" {
                Text(stoppedNote(message)).font(.footnote).foregroundStyle(colors.muted)
            }
            // A lost login's error only says to sign in again, which the note says better from here.
            if let provider = message.signIn {
                SignInNote(provider: provider)
            } else if let error = message.error, message.status != "cancelled" {
                AgentErrorNote(error: error)
            }
            if !message.streaming {
                MessageActions(chatId: chatId, message: message, replies: main)
            }
            repliesLink
        }
        .openingFileLinks(chatId: chatId, message: message, root: root)
    }

    /// An answer's own pictures in the thread's folder, drawn where it puts them once it's done.
    private func answerImage(among: [MessageImage]) -> ((MdImage) -> AnyView)? {
        guard let root else { return nil }
        let chatId = chatId, message = message
        return { image in
            guard !message.streaming, let path = localImagePath(image.source, root: root) else { return AnyView(EmptyView()) }
            return AnyView(
                AnswerImage(source: .read(chatId: chatId, messageId: message.id, path: path), alt: image.alt, among: among))
        }
    }

    @ViewBuilder
    private var repliesLink: some View {
        if replies > 0 {
            Button { navigate(.replies(chatId: chatId, rootId: message.id)) } label: {
                Label("\(replies) \(replies == 1 ? "reply" : "replies")", systemImage: "arrowshape.turn.up.left")
            }
            .font(.subheadline)
            .foregroundStyle(colors.accent)
            .buttonStyle(.plain)
        }
    }

    /// Who wrote it, quietly: the agent with its mark, or a sender other than you.
    private func byline(_ name: String, mark provider: String? = nil) -> some View {
        HStack(spacing: 6) {
            if let provider { ProviderMark(provider: provider, size: 13) }
            Text(name).fontWeight(.medium)
            if provider != nil, let author = message.author {
                Text("via \(author)").foregroundStyle(colors.faint)
            }
            if message.unprompted == true {
                Text("started on its own").foregroundStyle(colors.faint)
            }
        }
        .font(.footnote)
        .foregroundStyle(colors.muted)
        .lineLimit(1)
    }
}
