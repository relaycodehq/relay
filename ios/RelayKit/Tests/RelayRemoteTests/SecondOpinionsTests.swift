import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's SecondOpinionsTest.

private func answer(
    body: String = "It holds.", status: String = "complete", parentId: String? = nil, side: Bool? = nil,
    role: String = "assistant"
) -> ChatMessage {
    var f: [String: JSON] = [
        "id": "a", "role": .string(role), "body": .string(body), "status": .string(status), "created": 1,
        "provider": "claude", "version": 1,
    ]
    if let parentId { f["parentId"] = .string(parentId) }
    if let side { f["side"] = .bool(side) }
    return try! JSON.object(f).decode()
}

private func thread(
    _ id: String, on: String? = nil, lead: String = "lead", created: Int64 = 1, running: Bool? = nil
) -> RemoteChatSummary {
    var startedBy: [String: JSON] = ["chatId": .string(lead), "agent": "claude"]
    if let on { startedBy["secondOpinionOn"] = .string(on) }
    var f: [String: JSON] = [
        "id": .string(id), "projectId": "p", "title": .string(id), "scope": "project",
        "updated": .number(Double(created)), "created": .number(Double(created)), "startedBy": .object(startedBy),
    ]
    if let running { f["running"] = .bool(running) }
    return try! JSON.object(f).decode()
}

@Test func offersOnlyFinishedMainAnswers() {
    #expect(offersSecondOpinion(answer()))
    #expect(!offersSecondOpinion(answer(status: "streaming")))
    #expect(!offersSecondOpinion(answer(body: "  ")))
    #expect(!offersSecondOpinion(answer(parentId: "q")))
    #expect(!offersSecondOpinion(answer(side: true)))
    #expect(!offersSecondOpinion(answer(role: "user")))
}

@Test func findsTheOpinionsOnOneAnswer() {
    let chats = [
        thread("late", on: "a", created: 3), thread("other", on: "b"), thread("started"),
        thread("early", on: "a", created: 2), thread("elsewhere", on: "a", lead: "x"),
    ]
    #expect(opinionsOn("lead", "a", chats).map(\.id) == ["early", "late"])
}

@Test func keepsOpinionsOutOfTheStartedThreads() {
    #expect(startedOf("lead", [thread("opinion", on: "a"), thread("started")]).map(\.id) == ["started"])
}

@Test func standsByItsLatestAnswer() {
    #expect(opinionStanding(thread("o", running: true), answer()) == "working")
    #expect(opinionStanding(thread("o"), nil) == "working")
    #expect(opinionStanding(thread("o"), answer(status: "failed")) == "failed")
    #expect(opinionStanding(thread("o"), answer(status: "cancelled")) == "stopped")
    #expect(opinionStanding(thread("o"), answer()) == "finished")
}

@Test func namesWhoGivesIt() {
    #expect(opinionTitle("codex", "GPT-5.5") == "Second opinion · GPT-5.5")
    #expect(opinionTitle("codex", "") == "Second opinion · Codex")
    #expect(opinionTitle(nil, nil) == "Second opinion")
    #expect(unsentLine("claude", nil) == "Claude hasn't seen this.")
    #expect(unsentLine("claude", "It's on lubopc now") == "It's on lubopc now")
}

@Test func readsWhatItWasAsked() throws {
    let m: ChatMessage = try JSON.object([
        "id": "q", "role": "user", "body": "prompt", "status": "complete", "created": 1, "provider": "codex",
        "version": 1, "secondOpinion": ["answer": "Use a mutex."],
    ]).decode()
    #expect(m.secondOpinion?.question == "")
    #expect(m.secondOpinion?.answer == "Use a mutex.")
}
