import Foundation

// Android's ChatState.kt and ChatActivity.kt (from mobile/src/remote/chat-state.ts and
// shared/projects/messages.ts): a held thread, its conversations, and how far it's been read.

/// Sequenced messages in the thread's order, then ones not yet sequenced by when they were made.
public func threadOrder(_ a: ChatMessage, _ b: ChatMessage) -> Bool {
    let x = a.seq.flatMap { $0 == 0 ? nil : $0 }
    let y = b.seq.flatMap { $0 == 0 ? nil : $0 }
    switch (x, y) {
    case let (x?, y?): return x < y
    case (.some, nil): return true
    case (nil, .some): return false
    case (nil, nil): return a.created < b.created
    }
}

/// A streamed update; an older version than the phone holds is dropped.
public func applyMessage(_ thread: RemoteChat, _ message: ChatMessage) -> RemoteChat {
    var next = thread
    if let at = thread.messages.firstIndex(where: { $0.id == message.id }) {
        if thread.messages[at].version > message.version { return thread }
        next.messages[at] = message
    } else {
        next.messages = (thread.messages + [message]).sorted(by: threadOrder)
    }
    return next
}

/// A fetched thread, keeping any message a stream moved past or brought while the fetch ran.
/// `asked` is what was held when the fetch began: a message held then that the fetch leaves out
/// is gone from the thread, but one streamed in since may be newer than the fetch.
public func keepNewer(_ fetched: RemoteChat, _ held: RemoteChat?, asked: RemoteChat?) -> RemoteChat {
    guard let held else { return fetched }
    let newer = Dictionary(held.messages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    var next = fetched
    next.messages = fetched.messages.map { m in
        if let n = newer[m.id], heldIsNewer(n, than: m) { n } else { m }
    }
    let known = Set(fetched.messages.map(\.id)).union(asked?.messages.map(\.id) ?? [])
    let arrived = held.messages.filter { !known.contains($0.id) }
    if !arrived.isEmpty { next.messages = (next.messages + arrived).sorted(by: threadOrder) }
    return next
}

/// A later version, or the same one with the steps its fetched copy left out.
private func heldIsNewer(_ held: ChatMessage, than fetched: ChatMessage) -> Bool {
    if held.version != fetched.version { return held.version > fetched.version }
    return fetched.stepsLeftOut != nil && held.stepsLeftOut == nil
}

/// The thread with a folded turn's steps back in place.
public func withSteps(_ thread: RemoteChat, messageId: String, _ steps: MessageSteps) -> RemoteChat {
    var next = thread
    next.messages = thread.messages.map { m in
        guard m.id == messageId else { return m }
        var opened = m
        opened.trace = steps.trace
        opened.activity = steps.activity
        opened.traceDropped = steps.traceDropped
        opened.stepsLeftOut = nil
        opened.stepsSummary = nil
        return opened
    }
    return next
}

/// The main conversation: everything but replies. A reply whose parent is gone shows here rather than nowhere.
public func mainMessages(_ messages: [ChatMessage]) -> [ChatMessage] {
    let ids = Set(messages.map(\.id))
    return messages.filter { m in m.parentId.map { !ids.contains($0) } ?? true }
}

/// The message a reply chain starts from; a missing parent or a loop ends the chain where it breaks.
func chainRoot(_ byId: [String: ChatMessage], _ message: ChatMessage) -> ChatMessage {
    var seen = Set<String>()
    var current = message
    while let parent = current.parentId, seen.insert(current.id).inserted {
        guard let next = byId[parent] else { break }
        current = next
    }
    return current
}

/// Each reply's side conversation, by the message it starts from.
public func replyRoots(_ messages: [ChatMessage]) -> [String: String] {
    let byId = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    var roots: [String: String] = [:]
    for m in messages where m.parentId != nil {
        let root = chainRoot(byId, m)
        if root.id != m.id { roots[m.id] = root.id }
    }
    return roots
}

/// A side conversation: its root, then the replies under it in order.
public func sideConversation(_ messages: [ChatMessage], root: String) -> [ChatMessage] {
    let roots = replyRoots(messages)
    return messages.filter { $0.id == root || roots[$0.id] == root }
}

/// How many replies each root has.
public func replyCounts(_ messages: [ChatMessage]) -> [String: Int] {
    var counts: [String: Int] = [:]
    for root in replyRoots(messages).values { counts[root, default: 0] += 1 }
    return counts
}

/// The agent holding a conversation's context: the last one that answered in it.
public func contextAgent(_ conversation: [ChatMessage], rootId: String? = nil) -> String? {
    conversation.last {
        $0.role == "assistant" && $0.compaction != true && $0.handoff == nil && $0.reload == nil
            && $0.worktreeCommand == nil && $0.id != rootId
    }?.provider
}

/// Whether sending to `to` takes over from `holder`, losing its session.
public func takesOver(_ to: String?, holder: String?) -> Bool {
    guard let to, let holder else { return false }
    return to != "message" && to != holder
}

/// What a conversation's composer starts on: what the thread last sent, on the agent holding
/// this conversation when that send was a reply elsewhere.
public func conversationSettings(_ last: ResumeSettings, lastParentId: String?, rootId: String?, holder: String?)
    -> ResumeSettings
{
    lastParentId != rootId && holder != nil ? last.onAgent(holder!) : last
}

/// What a go-ahead for `provider`'s plan says.
public func implementPlan(_ provider: String) -> String { "@\(provider) Implement the plan from your previous response." }

/// shared/open-plan.ts: the agent whose proposed plan still waits for a go-ahead in the open
/// conversation. `view` is what that conversation shows, `messages` the whole thread. Nothing
/// may have followed the plan in its own conversation or in the replies under it.
public func openPlan(_ messages: [ChatMessage], view: [ChatMessage]) -> String? {
    guard let plan = view.last, plan.status == "complete", plan.proposedPlan == true else { return nil }
    let roots = replyRoots(messages)
    let planLine = roots[plan.id]
    let followed = messages.contains { m in
        m.id != plan.id && threadOrder(plan, m) && (roots[m.id] == planLine || roots[m.id] == plan.id)
    }
    return followed ? nil : plan.provider
}

/// Its snooze ran out and it hasn't been read since: the row says "Woke up".
public func wokeUnread(_ chat: RemoteChatSummary, now: Int64) -> Bool {
    guard let until = chat.snoozedUntil else { return false }
    return until <= now && (chat.seenAt ?? 0) < until
}

/// How far opening a thread reads it: past its wake time once it woke.
public func openedUpTo(_ updated: Int64, snoozedUntil: Int64?, now: Int64) -> Int64 {
    if let until = snoozedUntil, until <= now { return max(updated, until) }
    return updated
}

/// Which threads moved since this phone last looked (mobile/src/remote/seen.ts), as the
/// desktop's sidebar keeps it per device: a thread is unread once it updates after its last visit.
public struct ThreadSeen: Codable, Sendable, Equatable {
    public var seen: [String: Int64]
    /// The phone's first look; threads older than it aren't news.
    public var since: Int64

    public init(seen: [String: Int64] = [:], since: Int64) {
        self.seen = seen
        self.since = since
    }

    public func readUpTo(_ chat: RemoteChatSummary) -> Int64 { max(since, seen[chat.id] ?? 0, chat.seenAt ?? 0) }
    public func movedSinceSeen(_ chat: RemoteChatSummary) -> Bool { chat.updated > readUpTo(chat) }

    /// The open thread, while the app is in front, only counts what moved; a mark doesn't stick to it.
    public func unread(_ chat: RemoteChatSummary, open: String? = nil, foreground: Bool = true) -> Bool {
        chat.id == open && foreground ? movedSinceSeen(chat) : chat.markedUnread == true || movedSinceSeen(chat)
    }

    /// Read up to `updated`, while it's open on the phone; false when that's nothing new.
    public mutating func markSeen(_ id: String, updated: Int64) -> Bool {
        guard (seen[id] ?? 0) < updated else { return false }
        seen[id] = updated
        return true
    }
}
