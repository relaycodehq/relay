import RelayRemote
import Testing

@testable import Relay

@MainActor
struct NewThreadDefaultsTests {
    private let codex = ResumeSettings(
        provider: "codex", choice: ModelChoice(model: "gpt-6.1-sol", reasoningEffort: "high"),
        runtimeMode: "auto-accept-edits", interactionMode: "default")
    private let opus = ResumeSettings(
        provider: "claude", choice: ModelChoice(model: "opus", reasoningEffort: "max"), contextWindow: "200k",
        runtimeMode: "read-only", interactionMode: "default")

    @Test func reopeningNewRefreshesAgentModelReasoningAndAccessOnTheSameConnection() async throws {
        try await ReadOwnershipFixture.run { fixture in
            try await load(fixture, settings: codex)
            #expect(fixture.connection.newThread?.settings == codex)
            try await load(fixture, settings: opus, fresh: true)
            #expect(fixture.connection.newThread?.settings == opus)
            #expect(fixture.connection.newThread?.models["claude"] == NewThreadModel(opus))
        }
    }

    @Test func anExistingThreadsFallbackStillUsesTheCache() async throws {
        try await ReadOwnershipFixture.run { fixture in
            try await load(fixture, settings: opus)
            let count = fixture.a.desktopCalls.count
            await fixture.connection.loadNewThread()
            #expect(fixture.a.desktopCalls.count == count)
            #expect(fixture.connection.newThread?.settings == opus)
        }
    }

    @Test func aRefreshCannotOverwriteAPickMadeWhileItWasLoading() async throws {
        try await ReadOwnershipFixture.run { fixture in
            try await load(fixture, settings: codex)
            let read = Task { await fixture.connection.loadNewThread(fresh: true) }
            try await fixture.until { fixture.a.pendingDesktop == 4 }
            let calls = Array(fixture.a.desktopCalls.suffix(4))
            fixture.connection.rememberNewThread(opus, over: codex)
            try answer(fixture, calls: calls, settings: codex)
            await read.value
            #expect(fixture.connection.newThread?.settings == opus)
        }
    }

    @Test func anOlderRefreshCannotPublishAfterANewerOneHasStarted() async throws {
        try await ReadOwnershipFixture.run { fixture in
            try await load(fixture, settings: opus)
            let older = Task { await fixture.connection.loadNewThread(fresh: true) }
            try await fixture.until { fixture.a.pendingDesktop == 4 }
            let olderCalls = Array(fixture.a.desktopCalls.suffix(4))
            let newer = Task { await fixture.connection.loadNewThread(fresh: true) }
            try await fixture.until { fixture.a.pendingDesktop == 8 }
            let newerCalls = Array(fixture.a.desktopCalls.suffix(4))
            try answer(fixture, calls: olderCalls, settings: codex)
            await older.value
            #expect(fixture.connection.newThread?.settings == opus)
            try answer(fixture, calls: newerCalls, settings: opus)
            await newer.value
            #expect(fixture.connection.newThread?.settings == opus)
        }
    }

    @Test func leavingNewCancelsItsRefreshWithoutReplacingTheCache() async throws {
        try await ReadOwnershipFixture.run { fixture in
            try await load(fixture, settings: opus)
            let read = Task { await fixture.connection.loadNewThread(fresh: true) }
            try await fixture.until { fixture.a.pendingDesktop == 4 }
            let calls = Array(fixture.a.desktopCalls.suffix(4))
            read.cancel()
            try answer(fixture, calls: calls, settings: codex)
            await read.value
            #expect(fixture.connection.newThread?.settings == opus)
        }
    }

    @Test func switchingComputersDiscardsThePreviousComputersDefaults() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let read = Task { await fixture.connection.loadNewThread(fresh: true) }
            try await fixture.until { fixture.a.pendingDesktop == 4 }
            try answer(fixture, calls: Array(fixture.a.desktopCalls.suffix(4)), settings: opus)
            fixture.connection.switchTo(fixture.b.credentials.key)
            await read.value
            #expect(fixture.connection.newThread == nil)
            #expect(fixture.b.desktopCalls.isEmpty)
        }
    }

    @Test func cancellingTheFirstLoadStillLetsAnExistingThreadFetchItsFallback() async throws {
        try await ReadOwnershipFixture.run { fixture in
            let read = Task { await fixture.connection.loadNewThread(fresh: true) }
            try await fixture.until { fixture.a.pendingDesktop == 4 }
            let calls = Array(fixture.a.desktopCalls.suffix(4))
            read.cancel()
            try answer(fixture, calls: calls, settings: codex)
            await read.value
            #expect(fixture.connection.newThread == nil)
            try await load(fixture, settings: opus)
            #expect(fixture.connection.newThread?.settings == opus)
        }
    }

    private func load(_ fixture: ReadOwnershipFixture, settings: ResumeSettings, fresh: Bool = false) async throws {
        let read = Task { await fixture.connection.loadNewThread(fresh: fresh) }
        try await fixture.until { fixture.a.pendingDesktop == 4 }
        try answer(fixture, calls: Array(fixture.a.desktopCalls.suffix(4)), settings: settings)
        await read.value
    }

    private func answer(_ fixture: ReadOwnershipFixture, calls: [ReadDesktop.Call], settings: ResumeSettings) throws {
        for call in calls {
            let value: JSON
            switch call.args.first?.string {
            case "newThreadAgent": value = .string(settings.provider)
            case "aiSettings": value = ["threadProvider": "codex"]
            case "newThreadModels": value = try JSON(encoding: [settings.provider: NewThreadModel(settings)])
            case "newThreadRuntimeMode": value = .string(settings.runtimeMode)
            default: throw PairingError("Unexpected defaults call")
            }
            try fixture.a.answerDesktop(value)
        }
    }
}
