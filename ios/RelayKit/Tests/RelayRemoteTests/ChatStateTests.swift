import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's ThreadLogicTest, OpenPlanTest and ChatActivityTest.

private func msg(
    _ id: String, role: String = "assistant", body: String? = nil, seq: Int64? = nil, created: Int64 = 1_000,
    version: Int64 = 1, parentId: String? = nil, plan: Bool? = nil, status: String = "complete"
) -> ChatMessage {
    var fields: [String: JSON] = [
        "id": .string(id), "role": .string(role), "body": .string(body ?? id), "status": .string(status),
        "created": .number(Double(created)), "provider": .string("claude"), "version": .number(Double(version)),
    ]
    if let seq { fields["seq"] = .number(Double(seq)) }
    if let parentId { fields["parentId"] = .string(parentId) }
    if let plan { fields["proposedPlan"] = .bool(plan) }
    return try! JSON.object(fields).decode()
}

private func chat(_ messages: [ChatMessage]) -> RemoteChat {
    var c: RemoteChat = try! JSON.parse(#"{"id":"t","projectId":"p","title":"T","scope":{"kind":"project"},"messages":[]}"#)
        .decode()
    c.messages = messages
    return c
}

@Test func aHeldThreadKeepsTheNewestOfEachMessage() {
    let held = chat([msg("a", seq: 1), msg("b", seq: 2, version: 5)])
    #expect(applyMessage(held, msg("b", seq: 2, version: 4)) == held)
    // Unsequenced messages sort after sequenced ones, even when made earlier.
    #expect(applyMessage(held, msg("c", created: 0)).messages.map(\.id) == ["a", "b", "c"])
    let fetched = chat([msg("a", seq: 1, version: 2), msg("b", seq: 2, version: 3)])
    #expect(keepNewer(fetched, held).messages.map(\.version) == [2, 5])
}

@Test func repliesFormSideConversations() {
    let list = [msg("root"), msg("r1", parentId: "root"), msg("r2", parentId: "r1"), msg("lost", parentId: "gone"), msg("next")]
    #expect(mainMessages(list).map(\.id) == ["root", "lost", "next"])
    #expect(sideConversation(list, root: "root").map(\.id) == ["root", "r1", "r2"])
    #expect(replyCounts(list) == ["root": 2])
}

@Test func offersAPlanOnlyWhileNothingFollowedIt() {
    var n: Int64 = 0
    func m(_ id: String, _ role: String, _ body: String? = nil, parentId: String? = nil, plan: Bool? = nil) -> ChatMessage {
        n += 1
        return msg(id, role: role, body: body, seq: n, created: n, parentId: parentId, plan: plan)
    }
    let other = m("other", "assistant")
    let ask = m("ask", "user", "@claude plan retries")
    let plan = m("plan", "assistant", plan: true)
    let go = m("go", "user", implementPlan("claude"))
    let build = m("build", "assistant")
    #expect(openPlan([ask, plan], view: mainMessages([ask, plan])) == "claude")
    let ahead = [ask, plan, go, build]
    #expect(openPlan(ahead, view: sideConversation(ahead, root: plan.id)) == nil)
    #expect(openPlan(ahead, view: mainMessages(ahead)) == nil)
    let reply = m("reply-go", "user", implementPlan("claude"), parentId: plan.id)
    #expect(openPlan([ask, plan, reply], view: mainMessages([ask, plan, reply])) == nil)
    let aside = m("aside", "user", parentId: other.id)
    let beside = [other, ask, plan, aside]
    #expect(openPlan(beside, view: mainMessages(beside)) == "claude")
    let streaming = msg("plan", seq: 99, plan: true, status: "streaming")
    #expect(openPlan([ask, streaming], view: [ask, streaming]) == nil)
}

@Test func aWokenThreadStaysNewsUntilOpened() throws {
    var woke: RemoteChatSummary = try JSON.parse(
        #"{"id":"t","projectId":"p","title":"T","scope":"project","updated":100,"created":1,"snoozedUntil":500}"#
    ).decode()
    #expect(!wokeUnread(woke, now: 400))
    #expect(wokeUnread(woke, now: 600))
    // Opening it reads past the wake time, though nothing new came in.
    woke.seenAt = openedUpTo(woke.updated, snoozedUntil: woke.snoozedUntil, now: 600)
    #expect(!wokeUnread(woke, now: 700))
    woke.snoozedUntil = 900
    #expect(!wokeUnread(woke, now: 800))
    #expect(wokeUnread(woke, now: 1_000))
    // Opened while still asleep, it reads only what's there.
    #expect(openedUpTo(woke.updated, snoozedUntil: woke.snoozedUntil, now: 800) == 100)
}

@Test func aThreadIsUnreadOnceItMovesPastItsLastVisit() throws {
    let chat: RemoteChatSummary = try JSON.parse(
        #"{"id":"t","projectId":"p","title":"T","scope":"project","updated":300,"created":1}"#
    ).decode()
    var seen = ThreadSeen(since: 100)
    #expect(seen.unread(chat))
    let marked = seen.markSeen("t", updated: 300)
    let again = seen.markSeen("t", updated: 200)
    #expect(marked && !again)
    #expect(!seen.unread(chat))
    #expect(!ThreadSeen(since: 400).unread(chat))
}

@Test func aSideReplyElsewhereHandsTheNextSendToTheHolder() {
    let last = ResumeSettings(
        provider: "codex", choice: ModelChoice(model: "x"), contextWindow: nil, runtimeMode: "auto",
        interactionMode: "default")
    #expect(conversationSettings(last, lastParentId: "root", rootId: nil, holder: "claude").provider == "claude")
    #expect(conversationSettings(last, lastParentId: nil, rootId: nil, holder: "claude").provider == "codex")
    #expect(takesOver("codex", holder: "claude") && !takesOver("message", holder: "claude") && !takesOver("claude", holder: nil))
    // The agent that answered last in the conversation, not the one it's a reply to.
    let list = [msg("root", seq: 1), msg("r1", role: "user", parentId: "root")]
    #expect(contextAgent(list, rootId: "root") == nil)
    #expect(contextAgent(list) == "claude")
}
