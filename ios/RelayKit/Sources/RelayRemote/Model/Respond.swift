import Foundation

/// `agentResponseSchema` (shared/agent-modes.ts): the user's answer to an agent.
public enum AgentResponse: Sendable, Equatable {
    /// "accept" | "acceptForSession" | "decline" | "cancel"
    case decision(String)
    /// Each question's id to the chosen labels or typed text.
    case answers([String: [String]])
    /// A page's answer; nil skips it.
    case page(String?)

    var json: JSON {
        switch self {
        case .decision(let d): ["kind": "approval", "decision": .string(d)]
        case .answers(let a): ["kind": "question", "answers": .object(a.mapValues { .array($0.map(JSON.string)) })]
        case .page(let answer): ["kind": "page", "answer": answer.map(JSON.string) ?? .null]
        }
    }
}

public extension RemoteClient {
    /// Answers a request the running turn waits on (`chat.requests`).
    func respond(chatId: String, requestId: String, _ response: AgentResponse) async throws {
        _ = try await desktop("respondProjectChat", [.string(chatId), .string(requestId), response.json])
    }

    /// Answers a question group the agent asked without stopping (`message.questions`).
    func answerQuestion(chatId: String, messageId: String, groupId: String, _ response: AgentResponse) async throws {
        _ = try await desktop(
            "answerProjectChatQuestion", [.string(chatId), .string(messageId), .string(groupId), response.json])
    }

    func setQuestionDismissed(chatId: String, messageId: String, groupId: String, _ dismissed: Bool) async throws {
        _ = try await desktop(
            "setProjectChatQuestionDismissed",
            [.string(chatId), .string(messageId), .string(groupId), .bool(dismissed)])
    }
}
