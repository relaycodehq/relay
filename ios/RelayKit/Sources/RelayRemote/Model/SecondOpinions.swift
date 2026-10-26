import Foundation

// src/features/second-opinion (Android's logic/SecondOpinions.kt): another
// agent checks one of a thread's answers in a read-only thread of its own,
// listed under the answer it checks.

/// `shared/second-opinion.ts`: the question (empty when none) and the answer a second opinion checks.
public struct SecondOpinionAsked: Codable, Sendable, Equatable {
    public var question: String
    public var answer: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        question = try c.decodeIfPresent(String.self, forKey: .question) ?? ""
        answer = try c.decode(String.self, forKey: .answer)
    }
}

/// A finished answer of the main conversation; a side conversation's never reach its session.
public func offersSecondOpinion(_ m: ChatMessage) -> Bool {
    m.role == "assistant" && m.status == "complete" && !m.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && m.parentId == nil && m.side != true
}

public func isSecondOpinion(_ chat: RemoteChatSummary) -> Bool { chat.startedBy?.secondOpinionOn != nil }

/// The second opinions asked on answer `answerId` of thread `lead`.
public func opinionsOn(_ lead: String, _ answerId: String, _ chats: [RemoteChatSummary]) -> [RemoteChatSummary] {
    chats.filter { $0.startedBy?.chatId == lead && $0.startedBy?.secondOpinionOn == answerId }.sorted { $0.created < $1.created }
}

/// Where a second opinion's thread stands, from its latest answer: "working", "failed", "stopped" or "finished".
public func opinionStanding(_ chat: RemoteChatSummary, _ reply: ChatMessage?) -> String {
    if chat.running == true { return "working" }
    if reply?.status == "failed" { return "failed" }
    if reply?.status == "cancelled" { return "stopped" }
    // Not answering yet is only its first message on its way.
    let said = !(reply?.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    return said ? "finished" : "working"
}

/// The card's title: who gives the opinion, by model once it has answered, else by agent.
public func opinionTitle(_ provider: String?, _ model: String?) -> String {
    let by = model.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? provider.map(agentName)
    return by.map { "Second opinion · \($0)" } ?? "Second opinion"
}

/// What the card's footer says before it's sent back.
public func unsentLine(_ checked: String, _ error: String?) -> String { error ?? "\(agentName(checked)) hasn't seen this." }

public extension RemoteClient {
    /// Starts a read-only thread where `provider` checks answer `answerId`; `model` is "" for its Default.
    func askSecondOpinion(chatId: String, answerId: String, provider: String, model: String) async throws {
        _ = try await desktop(
            "askSecondOpinion",
            [.string(chatId), .string(answerId), .object(["provider": .string(provider), "model": .string(model)])])
    }

    /// Sends finished second opinion `opinionId` to the agent whose answer it checked.
    func sendSecondOpinion(_ opinionId: String) async throws {
        _ = try await desktop("sendSecondOpinion", [.string(opinionId)])
    }
}
