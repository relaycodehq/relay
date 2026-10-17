import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's OutboxTest (mobile/src/remote/outbox.test.ts).

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
    var onComputer: Set<String> = []
    var hold: Gate?
    var asked: Gate?
    var askedFor = 0

    func holding(_ gate: Gate?) { hold = gate }
    func asking(_ gate: Gate?) { asked = gate }

    func send(chatId: String, _ send: ProjectChatSend) async throws {
        await hold?.pass()
        onComputer.insert(send.id)
    }

    func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws {
        try await self.send(chatId: chatId, send)
    }

    func chat(_ chatId: String, sendId: String) async throws -> RemoteChat {
        askedFor += 1
        await asked?.pass()
        let has = onComputer.contains(sendId)
        return try JSON.object([
            "id": "c", "projectId": "p", "title": "t", "scope": ["kind": "project"], "messages": [],
            "hasSend": .bool(has),
        ]).decode()
    }
}

private struct Dropped: OutboxLink {
    func send(chatId: String, _ send: ProjectChatSend) async throws { throw RemoteCallError.unanswered("Connection lost.") }
    func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws {
        throw RemoteCallError.unanswered("Connection lost.")
    }
    func chat(_ chatId: String, sendId: String) async throws -> RemoteChat {
        throw RemoteCallError.unanswered("Connection lost.")
    }
}

private let id = "11111111-1111-4111-8111-111111111111"
private let settings = ResumeSettings(
    provider: "codex", choice: ModelChoice(model: ""), runtimeMode: "full-access", interactionMode: "default")
private let send = ProjectChatSend(id: id, body: "Fix the bug", settings: settings)

@MainActor
private func until(_ done: () async -> Bool) async {
    for _ in 0..<1000 where !(await done()) { await Task.yield() }
}

@MainActor
struct OutboxTests {
    @Test func doesNotResendAnUnansweredSendEditIsAskingAbout() async throws {
        let outbox = Outbox(dir: nil)
        let desktop = Desktop()
        outbox.deliver(Dropped(), computer: "A", chatId: "c", send)
        await until { outbox.items.first?.error != nil }
        let unsent = try #require(outbox.of(computer: "A", chatId: "c").first)
        #expect(unsent.unsure == true)

        let asked = Gate()
        await desktop.asking(asked)
        let asking = Task { try await outbox.reached(desktop, unsent) }
        await until { await desktop.askedFor == 1 }
        outbox.resendFailed(desktop, computer: "A")
        await asked.release()
        #expect(try await asking.value == false)
        await until { false }
        #expect(await !desktop.onComputer.contains(id))
    }

    @Test func letsAResendOnItsWayLandBeforeAnsweringEdit() async throws {
        let outbox = Outbox(dir: nil)
        let desktop = Desktop()
        outbox.deliver(Dropped(), computer: "A", chatId: "c", send)
        await until { outbox.items.first?.error != nil }
        let hold = Gate()
        await desktop.holding(hold)
        outbox.resendFailed(desktop, computer: "A")
        let unsent = try #require(outbox.of(computer: "A", chatId: "c").first)
        let asking = Task { try await outbox.reached(desktop, unsent) }
        await until { false }
        await hold.release()
        #expect(try await asking.value == true)
        #expect(!outbox.isOut(id))
    }

    @Test func keepsWhatDidNotGoOutForTheNextLaunch() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "outbox-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let first = Outbox(dir: dir)
        first.deliver(Dropped(), computer: "A", chatId: "c", send)
        await until { first.items.first?.error != nil }

        let next = Outbox(dir: dir)
        let kept = try #require(next.items.first)
        #expect(kept.id == id)
        #expect(kept.error == "Relay closed before it went out")
        #expect(kept.unsure == true)

        let desktop = Desktop()
        next.retry(desktop, id)
        await until { next.items.first?.sent != nil }
        next.arrived(computer: "A", chatId: "c", held: [id], fetched: OutboxClock.stamp())
        #expect(next.items.isEmpty)
        #expect(Outbox(dir: dir).items.isEmpty)
    }

    @Test func forgetsTheOnesTheThreadHoldsOrTookBeforeAFetch() {
        var other = send
        other.id = "b"
        let a = Outgoing(computer: "A", chatId: "c", send: send, created: 1, sent: 3)
        let b = Outgoing(computer: "A", chatId: "c", send: other, created: 2)
        #expect(settled([a, b], computer: "A", chatId: "c", held: [], fetched: 4) == [a])
        #expect(settled([a, b], computer: "A", chatId: "c", held: ["b"], fetched: 2) == [b])
    }

    @Test func showsAPendingMessageWithItsImagesAndError() {
        var withImage = send
        withImage.images = [PastedImage(name: "shot.jpg", mimeType: "image/jpeg", data: Data(count: 297))]
        withImage.side = true
        let o = Outgoing(computer: "A", chatId: "c", send: withImage, created: 5, error: "Gone", unsure: true)
        let message = outgoingMessage(o)
        #expect(message.error == "Maybe not sent: Gone")
        #expect(message.images?.first?.id == "\(id):0")
        #expect(message.pending == true)
        #expect(message.side == true)

        let outbox = Outbox(dir: nil)
        outbox.deliver(Dropped(), computer: "A", chatId: "c", withImage)
        #expect(outbox.outgoingImage("\(id):0") == withImage.images?.first?.dataUrl)
        #expect(outbox.outgoingImage("\(id):1") == nil)
    }
}

struct OfflineCacheTests {
    @Test func keepsEachComputersLastOverview() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "offline-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let cache = OfflineCache(dir: dir)
        let overview: RemoteOverview = try JSON.object([
            "name": "Desk", "bridge": 23, "present": true, "projects": [["id": "p", "name": "relay"]],
            "chats": [["id": "a", "projectId": "p", "title": "A", "scope": "project", "updated": 2, "created": 1]],
        ]).decode()
        cache.save("key/1", overview)
        #expect(cache.load("key/1") == overview)
        #expect(cache.load("key/2") == nil)
        cache.forget("key/1")
        #expect(cache.load("key/1") == nil)
    }
}
