import Foundation
import Testing

@testable import RelayRemote

private let gpt = ResumeSettings(
    provider: "codex", choice: ModelChoice(model: "gpt-6-sol", reasoningEffort: "high"),
    contextWindow: nil, runtimeMode: "read-only", interactionMode: "default")
private let opus = ResumeSettings(
    provider: "claude", choice: ModelChoice(model: "opus", reasoningEffort: "max"),
    contextWindow: "200k", runtimeMode: "auto", interactionMode: "plan")

private func sent(_ id: String, _ settings: ResumeSettings, parent: String? = nil, side: Bool = false) throws -> ChatMessage {
    var message: ChatMessage = try JSON.parse(
        #"{"id":"q","role":"user","body":"Work on this","status":"complete","created":1,"provider":"codex","version":1}"#
    ).decode()
    message.id = id
    message.provider = settings.provider
    message.sentSettings = settings
    message.parentId = parent
    message.side = side
    return message
}

private func mirrored(_ messages: [ChatMessage]) throws -> RemoteChat {
    var thread: RemoteChat = try JSON.parse(
        #"{"id":"mirror","projectId":"p","title":"Remote thread","scope":{"kind":"project"},"messages":[],"running":true}"#
    ).decode()
    thread.messages = messages
    return thread
}

@Test func aMirroredMainThreadKeepsGptAfterAnOpusReply() throws {
    let main = try sent("main", gpt)
    let reply = try sent("reply", opus, parent: "main")
    let thread = try mirrored([main, reply])
    #expect(thread.settings == nil)
    #expect(threadComposerSettings(thread) == gpt)
    #expect(threadComposerSettings(thread, rootId: "main") == opus)
    #expect(!takesOver(threadComposerSettings(thread)?.provider, holder: "codex"))
}

@Test func mirroredBtwAndOrdinaryReplyRootsKeepTheirSettingsSeparate() throws {
    let main = try sent("main", gpt)
    let side = try sent("btw", opus, side: true)
    let thread = try mirrored([main, side])
    #expect(threadComposerSettings(thread) == gpt)
    #expect(threadComposerSettings(thread, rootId: "btw") == opus)
    #expect(threadComposerSettings(thread, rootId: "main") == nil)
}

@Test func anotherConversationsLegacyHeaderCannotOverrideTheMainMessagesModel() throws {
    var thread = try mirrored([sent("main", gpt), sent("reply", opus, parent: "main")])
    thread.settings = opus
    thread.lastParentId = "main"
    #expect(threadComposerSettings(thread) == gpt)
    #expect(threadComposerSettings(thread, rootId: "main") == opus)
}

@Test func notesDoNotChangeTheSelectedModelAndFreshHistoryUpdatesIt() throws {
    let main = try sent("main", gpt)
    var note = main
    note.id = "note"
    note.provider = "message"
    note.sentSettings = nil
    var thread = try mirrored([main, note])
    #expect(threadComposerSettings(thread) == gpt)
    thread.messages.append(try sent("new", opus))
    #expect(threadComposerSettings(thread) == opus)
}

@Test func olderThreadsWithoutMessageSettingsStillUseTheirSavedHeader() throws {
    var main = try sent("main", gpt)
    main.sentSettings = nil
    var thread = try mirrored([main])
    thread.settings = gpt
    #expect(threadComposerSettings(thread) == gpt)
}
