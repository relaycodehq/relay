import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's QueueList status line and shared/remote-queued.ts.

private func queued(_ json: String) throws -> RemoteQueued {
    try JSONDecoder().decode(RemoteQueued.self, from: Data(json.utf8))
}

private let settings = #"{"provider":"claude","choice":{"model":"opus"},"runtimeMode":"full-access","interactionMode":"default"}"#

@Test func takesAQueuedMessageBackWithoutItsMention() throws {
    let back = TakenBack(try queued(#"{"id":"a","body":"@codex tighten it","to":"codex","settings":\#(settings)}"#))
    #expect(back.body == "tighten it")
    // The agent it was queued for, though its settings were the composer's.
    #expect(back.settings?.provider == "codex")
    #expect(back.settings?.choice.model == "opus")
}

@Test func leavesANoteWholeAndTheAgentAlone() throws {
    let back = TakenBack(try queued(#"{"id":"a","body":"@codex is wrong here","to":"message","settings":\#(settings)}"#))
    #expect(back.body == "@codex is wrong here")
    #expect(back.settings == nil)
}

@Test func readsTheAgentFromTheMentionOnOlderDesktops() throws {
    let back = TakenBack(try queued(#"{"id":"a","body":"@claude go on"}"#))
    #expect(back.body == "go on")
    #expect(back.settings == nil)
}

@Test func aFailedSendTakenBackToEditBringsBackWhoItWasFor() throws {
    let picked = ResumeSettings(
        provider: "claude", choice: ModelChoice(model: "opus"), runtimeMode: "full-access", interactionMode: "default")
    let other = try #require(ProjectChatSend(body: "@codex look", settings: picked).sentWith)
    #expect(other.provider == "codex")
    #expect(other.choice.model == "")
    #expect(ProjectChatSend(body: "look", settings: picked).sentWith?.choice.model == "opus")
    var note = ProjectChatSend(body: "remember this", settings: picked)
    note.to = "message"
    #expect(note.sentWith == nil)
}

@Test func saysWhereAQueuedMessageStands() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Prague")!
    let clock = Clock(calendar: calendar, locale: Locale(identifier: "en_GB"))
    // Thursday 16 October 2025, 13:25 in Prague.
    let now: Int64 = 1_760_613_900_000
    let hour: Int64 = 3_600_000
    let plain = try queued(#"{"id":"a","body":"x"}"#)
    func status(_ item: RemoteQueued, _ index: Int, later: Bool = false, paused: Bool = false, compacting: Bool = false)
        -> String
    {
        queuedStatus(item, index: index, later: later, paused: paused, compacting: compacting, now: now, clock: clock)
    }
    #expect(status(plain, 0) == "Next")
    #expect(status(plain, 1) == "Queued")
    #expect(status(plain, 0, paused: true) == "Paused · send one now to carry on")
    #expect(status(plain, 1, paused: true) == "Queued")
    #expect(status(plain, 0, compacting: true) == "Sends after compaction")
    #expect(status(try queued(#"{"id":"a","body":"x","images":2}"#), 1) == "Queued · 2 images")
    #expect(status(try queued(#"{"id":"a","body":"x","error":"Codex can't take a steer"}"#), 0) == "Codex can't take a steer")
    #expect(status(try queued(#"{"id":"a","body":"x","at":\#(now + hour)}"#), 0, later: true) == "Sends 14:25")
    #expect(status(try queued(#"{"id":"a","body":"x","at":\#(now + 20 * hour)}"#), 0, later: true) == "Sends tomorrow 09:25")
    #expect(status(try queued(#"{"id":"a","body":"x","at":\#(now + 48 * hour)}"#), 0, later: true) == "Sends Sat 13:25")
}


@Test @MainActor func retriesAnUnansweredQueueRemovalOnce() async throws {
    var attempts = 0
    let confirmed = try await removeQueuedForEditing {
        attempts += 1
        if attempts == 1 { throw RemoteCallError.unanswered("Lost reply after removal") }
    }
    #expect(confirmed)
    #expect(attempts == 2)
}

@Test @MainActor func keepsTheRecoveredCopyWhenRemovalRemainsUncertain() async throws {
    for second in [RemoteCallError.unanswered("Lost again"), .notConnected("Offline"), .rejected("Relay is closing.")] {
        var attempts = 0
        let confirmed = try await removeQueuedForEditing {
            attempts += 1
            throw attempts == 1 ? RemoteCallError.unanswered("Lost reply") : second
        }
        #expect(!confirmed)
        #expect(attempts == 2)
    }
}

@Test @MainActor func rollsBackOnlyADefiniteFirstRefusal() async {
    var attempts = 0
    do {
        _ = try await removeQueuedForEditing {
            attempts += 1
            throw RemoteCallError.rejected("That message already went out.")
        }
        Issue.record("A definite refusal should reach the caller's undo")
    } catch {
        #expect(error as? RemoteCallError == .rejected("That message already went out."))
    }
    #expect(attempts == 1)
}
