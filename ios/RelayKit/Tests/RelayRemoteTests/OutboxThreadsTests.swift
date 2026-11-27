import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's OutboxThreadsTest: new threads this phone names are made before their first message goes.

/// Shut until opened; whoever waits on it then goes on.
private actor Gate {
    private var open = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func pass() async {
        if open { return }
        await withCheckedContinuation { waiting.append($0) }
    }

    func release() {
        open = true
        waiting.forEach { $0.resume() }
        waiting = []
    }
}

private actor Desktop: OutboxLink {
    var calls: [String] = []
    var gate: Gate?
    var refuse: Error?

    func holding(_ gate: Gate?) { self.gate = gate }
    func refusing(_ error: Error?) { refuse = error }

    func make(chatId: String, _ thread: ThreadToMake) async throws {
        calls.append("make \(chatId)")
        await gate?.pass()
        if let error = refuse {
            refuse = nil
            throw error
        }
    }

    func send(chatId: String, _ send: ProjectChatSend) async throws { calls.append("send \(send.id)") }

    func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws {
        try await self.send(chatId: chatId, send)
    }

    func chat(_ chatId: String, sendId: String) async throws -> RemoteChat {
        try JSON.object([
            "id": .string(chatId), "projectId": "p", "title": "t", "scope": ["kind": "project"], "messages": [],
            "hasSend": false,
        ]).decode()
    }
}

/// Never reaches the computer.
private struct Offline: OutboxLink {
    func make(chatId: String, _ thread: ThreadToMake) async throws {
        throw RemoteCallError.notConnected("Not connected.")
    }
    func send(chatId: String, _ send: ProjectChatSend) async throws { throw RemoteCallError.notConnected("Not connected.") }
    func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws {
        throw RemoteCallError.notConnected("Not connected.")
    }
    func chat(_ chatId: String, sendId: String) async throws -> RemoteChat {
        throw RemoteCallError.notConnected("Not connected.")
    }
}

private let thread = ThreadToMake(projectId: "p", workspace: "checkout")
private let settings = ResumeSettings(
    provider: "codex", choice: ModelChoice(model: ""), runtimeMode: "full-access", interactionMode: "default")
private func send(_ id: String) -> ProjectChatSend { ProjectChatSend(id: id, body: "Look at this", settings: settings) }

@MainActor
private func until(_ done: () async -> Bool) async {
    for _ in 0..<1000 where !(await done()) { await Task.yield() }
}

@MainActor
struct OutboxThreadsTests {
    @Test func makesTheThreadBeforeItsMessageGoes() async {
        let outbox = Outbox(dir: nil)
        let desktop = Desktop()
        outbox.deliver(desktop, computer: "A", chatId: "t1", send("m1"), make: thread)
        await until { outbox.items.first?.sent != nil }
        #expect(await desktop.calls == ["make t1", "send m1"])
        #expect(outbox.items.first?.make == nil)
    }

    @Test func aSecondMessageWaitsForItsThreadWhichIsMadeOnce() async {
        let outbox = Outbox(dir: nil)
        let desktop = Desktop()
        let gate = Gate()
        await desktop.holding(gate)
        outbox.deliver(desktop, computer: "A", chatId: "t1", send("m1"), make: thread)
        await until { await desktop.calls.count == 1 }
        outbox.deliver(desktop, computer: "A", chatId: "t1", send("m2"))
        await until { false }
        #expect(await desktop.calls == ["make t1"])
        await gate.release()
        await until { outbox.items.allSatisfy { $0.sent != nil } }
        let calls = await desktop.calls
        #expect(calls.first == "make t1")
        #expect(Set(calls.dropFirst()) == ["send m1", "send m2"])
    }

    @Test func anUnansweredMakeFailsTheSendAndTryAgainMakesItAgain() async throws {
        let outbox = Outbox(dir: nil)
        let desktop = Desktop()
        await desktop.refusing(RemoteCallError.unanswered("Connection lost."))
        outbox.deliver(desktop, computer: "A", chatId: "t1", send("m1"), make: thread)
        await until { outbox.items.first?.error != nil }
        let failed = try #require(outbox.items.first)
        #expect(failed.make == thread)
        outbox.retry(desktop, "m1")
        await until { outbox.items.first?.sent != nil }
        #expect(await desktop.calls == ["make t1", "make t1", "send m1"])
    }

    @Test func oneRelayClosedOnStillMakesItsThreadOnTheNextLaunch() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "outbox-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let first = Outbox(dir: dir)
        first.deliver(Offline(), computer: "A", chatId: "t1", send("m1"), make: thread)
        await until { first.items.first?.error != nil }
        let next = Outbox(dir: dir)
        let kept = try #require(next.items.first)
        #expect(kept.make == thread)
        // Its thread was never made, so it can't have reached the computer.
        #expect(try await next.reached(Desktop(), kept) == false)
    }
}
