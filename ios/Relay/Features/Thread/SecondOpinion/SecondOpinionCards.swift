import RelayRemote
import SwiftUI

/// Under an answer: the second opinions asked on it, and one being asked.
struct SecondOpinionCards: View {
    let chatId: String
    let answer: ChatMessage
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        let listed = opinionsOn(chatId, answer.id, connection.chats)
        let ask = SecondOpinions.shared.ask(chatId, answer.id)
        if !listed.isEmpty || ask != nil {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(listed) { thread in
                    OpinionCard(
                        chatId: chatId, thread: thread, checked: answer.provider,
                        reply: StartedPeeks.shared.peek(connection.active, thread.id).answer)
                }
                if let ask {
                    OpinionFrame(provider: ask.provider, title: "Second opinion", status: ask.error == nil ? "starting…" : "failed") {
                        if let error = ask.error { Text(error).font(.footnote).foregroundStyle(colors.destructive) }
                    }
                }
            }
            .task(id: listed.map { "\($0.id):\($0.running == true):\($0.updated)" }) {
                StartedPeeks.shared.follow(listed, connection)
            }
        }
    }
}

private struct OpinionCard: View {
    let chatId: String
    let thread: RemoteChatSummary
    /// The agent whose answer it checks.
    let checked: String
    let reply: ChatMessage?
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors

    var body: some View {
        let state = opinionStanding(thread, reply)
        let provider = thread.provider ?? reply?.provider
        OpinionFrame(
            provider: provider, title: opinionTitle(provider, reply?.model?.name), status: state,
            open: { navigate(.thread(thread.id)) }
        ) {
            if state == "failed" {
                Text(reply?.error.map { agentError($0).message } ?? "It failed.").font(.footnote)
                    .foregroundStyle(colors.destructive)
            } else if let reply, !reply.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Folded(lines: 6) { MarkdownView(reply.body, small: true) }
            } else {
                Text("Checking the answer…").font(.footnote).foregroundStyle(colors.muted)
            }
            if state == "finished" {
                SendBack(chatId: chatId, opinionId: thread.id, checked: checked)
            }
        }
    }
}

/// The card around a second opinion: who gives it, where it stands, and a tap into its thread.
private struct OpinionFrame<Content: View>: View {
    let provider: String?
    let title: String
    let status: String
    var open: (() -> Void)?
    @ViewBuilder let content: Content
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                open?()
            } label: {
                HStack(spacing: 7) {
                    if let provider { ProviderMark(provider: provider, size: 13) }
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(colors.foreground).lineLimit(1)
                    Spacer(minLength: 6)
                    Text(status).font(.caption).foregroundStyle(status == "failed" ? colors.destructive : colors.muted)
                    if open != nil {
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(colors.faint)
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(open == nil)
            .accessibilityHint(open == nil ? "" : "Opens its thread")
            content
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(.card))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(colors.border, lineWidth: 0.5))
    }
}

/// Sends the finished opinion to the agent whose answer it checked, once.
private struct SendBack: View {
    let chatId: String
    let opinionId: String
    let checked: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        let opinions = SecondOpinions.shared
        let who = agentName(checked)
        let sent = opinions.sentHere.contains(opinionId)
            || connection.threads[chatId]?.messages.contains { $0.fromThread == opinionId } == true
        if sent {
            Text("Sent to \(who).").font(.caption).foregroundStyle(colors.muted)
        } else {
            let error = opinions.sendErrors[opinionId]
            HStack(spacing: 10) {
                Text(unsentLine(checked, error)).font(.caption).foregroundStyle(error == nil ? colors.muted : colors.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button("Send to \(who)") { opinions.sendBack(opinionId, connection) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(opinions.sending.contains(opinionId))
            }
        }
    }
}

/// Long content folded to a few lines above a Show all.
struct Folded<Content: View>: View {
    var lines = 6
    @ViewBuilder let content: Content
    @Environment(\.colors) private var colors
    @State private var height: CGFloat = 0
    @State private var open = false
    @ScaledMetric(relativeTo: .footnote) private var line: CGFloat = 20

    var body: some View {
        let fold = line * CGFloat(lines)
        let long = height > fold + 1
        VStack(alignment: .leading, spacing: 4) {
            // Measured whole, so it knows it's long while folded and as a streaming answer grows.
            content
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
                .frame(maxHeight: long && !open ? fold : nil, alignment: .top)
                .clipped()
            if long {
                Button(open ? "Show less" : "Show all") { open.toggle() }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(colors.accent)
            }
        }
    }
}
