import RelayRemote
import SwiftUI

/// Questions the agent asked without stopping, under the answer that asked
/// them: open ones to answer or dismiss, the rest folded away.
struct AsyncQuestions: View {
    let chatId: String
    let message: ChatMessage

    var body: some View {
        ForEach(message.questions ?? []) { group in
            if group.answers != nil {
                Answered(group: group)
            } else if group.dismissed == true {
                Dismissed(chatId: chatId, messageId: message.id, group: group)
            } else {
                Open(chatId: chatId, message: message, group: group)
            }
        }
    }
}

private struct Open: View {
    let chatId: String
    let message: ChatMessage
    let group: AsyncAgentQuestions
    @Environment(Connection.self) private var connection
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(group.page?.title ?? "\(agentName(message.provider)) has a question", systemImage: "questionmark.bubble")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("Dismiss") { act { try await connection.dismissQuestion(chatId, message: message.id, group: group.id, true) } }
                    .font(.subheadline)
            }
            // What the agent asks with its page, unless it's only the title again.
            if let page = group.page, let ask = group.questions.first?.question, !ask.isEmpty, ask != page.title {
                Text(ask).font(.subheadline).foregroundStyle(.secondary)
            }
            if let page = group.page, connection.canRender {
                AskPage(chatId: chatId, page: page, busy: busy, share: 0.7) { send(.page($0)) }
            } else if group.page != nil {
                Text("Answer this page on your computer, or skip it.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Skip") { send(.page(nil)) }.buttonStyle(.glass)
            } else {
                Questions(questions: group.questions, deferred: true, busy: busy) { send(.answers($0)) }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .padding(14)
        .background(.card, in: .rect(cornerRadius: 18))
    }

    private func send(_ response: AgentResponse) {
        act { try await connection.answer(chatId, message: message.id, group: group.id, response) }
    }

    private func act(_ call: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do { try await call() } catch { self.error = error.localizedDescription }
        }
    }
}

private struct Dismissed: View {
    let chatId: String
    let messageId: String
    let group: AsyncAgentQuestions
    @Environment(Connection.self) private var connection

    var body: some View {
        HStack {
            Label("Dismissed question", systemImage: "questionmark.bubble")
            Spacer()
            Button("Reopen") {
                Task { try? await connection.dismissQuestion(chatId, message: messageId, group: group.id, false) }
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}

private struct Answered: View {
    let group: AsyncAgentQuestions
    @State private var open = false

    var body: some View {
        if let page = group.page {
            let answer = group.answers?["page"]?.joined(separator: "\n")
            DisclosureGroup(isExpanded: $open) {
                if let answer {
                    Text(answer).textSelection(.enabled).padding(.top, 6)
                }
            } label: {
                Label("\(answer != nil ? "Answered" : "Skipped") “\(page.title)”", systemImage: "checkmark.bubble")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        } else {
            questions
        }
    }

    private var questions: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(group.questions) { q in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(q.question).foregroundStyle(.secondary)
                        Text(q.isSecret == true ? "Hidden answer" : (group.answers?[q.id] ?? []).joined(separator: ", "))
                    }
                }
            }
            .padding(.top, 6)
        } label: {
            Label(group.questions.count == 1 ? "You answered its question" : "You answered its \(group.questions.count) questions",
                  systemImage: "checkmark.bubble")
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}
