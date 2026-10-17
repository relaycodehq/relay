import Foundation

/// shared/thread-news.ts (Android's ThreadNews.kt): a thread that finished, failed or asked you
/// something since the last list, worded for a notice.
public struct ThreadNews: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable { case waiting, finished, failed }

    public var chatId: String
    public var kind: Kind
    public var title: String
    public var body: String

    public var id: String { chatId }

    public init(_ chatId: String, _ kind: Kind, _ title: String, _ body: String) {
        self.chatId = chatId
        self.kind = kind
        self.title = title
        self.body = body
    }
}

/// A thread's latest answer in the main conversation, as its message events left it.
public struct LastAnswer: Sendable, Equatable {
    public var status: String
    public var body: String
    public var error: String?
    public var provider: String
    public var created: Int64

    public init(status: String, body: String, error: String? = nil, provider: String, created: Int64 = 0) {
        self.status = status
        self.body = body
        self.error = error
        self.provider = provider
        self.created = created
    }

    /// A main-conversation answer that can be news; nil for compactions, handoffs and replies.
    public init?(_ m: ChatMessage) {
        guard m.role == "assistant", m.parentId == nil, m.compaction != true, m.handoff == nil, m.reload == nil
        else { return nil }
        self.init(status: m.status, body: m.body, error: m.error, provider: m.provider, created: m.created)
    }
}

/// Threads that moved from one list to the next. A new thread isn't news, nor one read where it happened.
public func threadNews(
    before: [String: RemoteChatSummary], now: [RemoteChatSummary], answers: [String: LastAnswer], at: Int64,
    clock: Clock = Clock()
) -> [ThreadNews] {
    var news: [ThreadNews] = []
    for c in now {
        guard let was = before[c.id], !isRead(c) else { continue }
        let agent = c.provider.map(agentName) ?? "The agent"
        if c.waiting == true && was.waiting != true {
            news.append(ThreadNews(c.id, .waiting, c.title, "\(agent) needs you"))
            continue
        }
        if let limit = c.limitResume, was.limitResume == nil {
            let who = agentName(limit.provider)
            news.append(
                ThreadNews(
                    c.id, .failed, c.title,
                    limit.off == true
                        ? "\(who) hit its usage limit"
                        : "\(who) hit its usage limit · resumes the answer at \(clock.wakeLabel(limit.at, now: at))"))
            continue
        }
        guard was.running == true, c.running != true else { continue }
        // Every answer moves the thread past when its run started; a compaction while you were
        // away doesn't, and isn't news. Not the last list's updated: a save near the turn's end
        // can list the final one while the thread still reads as running.
        guard c.updated > (was.runningSince ?? was.updated) else { continue }
        // Snoozed: it comes back by itself when you said.
        guard (c.snoozedUntil ?? 0) <= at else { continue }
        let answer = answers[c.id]
        // An optional question must not hide a failure after the agent kept working.
        if c.waiting == true && answer?.status != "failed" { continue }
        // Someone stopped it, so someone knows.
        if answer?.status == "cancelled" { continue }
        // Settled while it ran: it finishes out of sight. A failure comes back to Activity.
        if answer?.status != "failed" && (chatSettled(was) || chatSettled(c)) { continue }
        if let answer, answer.status == "failed" {
            let error = answer.error?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            news.append(ThreadNews(c.id, .failed, c.title, error.isEmpty ? "\(agent)'s answer failed" : agentError(error).message))
        } else {
            let words = answer.map { preview($0.body) } ?? ""
            news.append(ThreadNews(c.id, .finished, c.title, words.isEmpty ? "\(agent) finished" : words))
        }
    }
    return news
}

/// Threads read since the last list, on the computer or another phone, whose notice can go.
public func threadsRead(before: [String: RemoteChatSummary], now: [RemoteChatSummary]) -> [String] {
    now.filter { isRead($0) && !isRead(before[$0.id]) }.map(\.id)
}

/// Read up to its latest, somewhere.
public func isRead(_ c: RemoteChatSummary?) -> Bool {
    guard let c, let seen = c.seenAt else { return false }
    return seen != 0 && seen >= c.updated
}
