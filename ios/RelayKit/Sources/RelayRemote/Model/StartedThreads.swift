import Foundation

// shared/started-threads.ts (Android's logic/StartedThreads.kt): threads a
// lead's agent started with start_threads, under the turn that started them and
// over the composer while any still works or asks.

public func isStartThreads(_ a: AgentActivity) -> Bool { a.mcp?.server == "relay" && a.mcp?.tool == "start_threads" }

/// The ids a start_threads call's result names, when it can be read.
public func startedIds(_ result: String?) -> [String]? {
    guard let result, let parsed = try? JSON.parse(result), let list = parsed.array else { return nil }
    let ids = list.compactMap { $0["id"]?.string }
    return ids.isEmpty ? nil : ids
}

/// The lead's started threads: needing you first, then working, then done; each oldest first.
/// A second opinion isn't among them: it shows under the answer it checks.
public func startedOf(_ lead: String, _ chats: [RemoteChatSummary]) -> [RemoteChatSummary] {
    chats.filter { $0.startedBy?.chatId == lead && !isSecondOpinion($0) }.sorted(by: byStanding)
}

public func familyLive(_ started: [RemoteChatSummary]) -> Bool {
    started.contains { $0.running == true || $0.waiting == true }
}

/// The strip over the composer tells of them while any works or asks; a review's reviewers always, as no list shows them.
public func familyInDock(_ started: [RemoteChatSummary]) -> Bool {
    familyLive(started) || started.contains { $0.reviewer == true }
}

private func callsOf(_ message: ChatMessage) -> [AgentActivity] {
    message.trace.map { $0.compactMap(\.activity) } ?? message.activity ?? []
}

/// A turn's start_threads calls that went through, or are still going.
public func startCalls(_ message: ChatMessage) -> [AgentActivity] {
    callsOf(message).filter { isStartThreads($0) && $0.status != "failed" }
}

public struct StartGroup: Sendable, Equatable, Identifiable {
    public var id: String
    public var count: Int
    public var threads: [RemoteChatSummary]
}

/// Each start_threads call in a turn with the threads it started; an unreadable
/// result falls back to the threads made while the turn ran.
public func startGroups(_ message: ChatMessage, _ started: [RemoteChatSummary]) -> [StartGroup] {
    let calls = startCalls(message)
    guard let first = calls.first else { return [] }
    let ids = calls.map { ($0.detailCut ?? 0) != 0 ? nil : startedIds($0.detail) }
    if ids.allSatisfy({ $0 != nil }) {
        return zip(calls, ids).map { call, ids in
            let set = Set(ids!)
            return StartGroup(id: call.id, count: ids!.count, threads: started.filter { set.contains($0.id) }.sorted(by: byStanding))
        }
    }
    let end = message.ended ?? .max
    let during = started.filter { $0.created >= message.created && $0.created <= end }.sorted(by: byStanding)
    return during.isEmpty ? [] : [StartGroup(id: first.id, count: during.count, threads: during)]
}

/// What the strip over the composer says, with the subagents working beside them.
public func slotLine(_ started: [RemoteChatSummary], agents: Int = 0) -> String {
    guard agents > 0 else { return familyLine(started) }
    let asking = started.count(where: { $0.waiting == true })
    let working = started.count(where: { $0.running == true && !inputBlocksThread($0) })
    let needs = { (n: Int) in "need\(n == 1 ? "s" : "") you" }
    var parts = [plural(agents, "agent")]
    if working > 0 { parts.append("\(plural(working, "thread")) working") }
    if asking > 0 { parts.append(working > 0 ? "\(asking) \(needs(asking))" : "\(plural(asking, "thread")) \(needs(asking))") }
    return parts.joined(separator: " · ")
}

public struct StartedNow: Sendable, Equatable {
    public var asks: Bool
    public var text: String

    public init(asks: Bool, text: String) {
        self.asks = asks
        self.text = text
    }
}

/// The last thing a started thread said or is doing.
public func startedNow(_ chat: RemoteChatSummary, answer: ChatMessage?, request: String?) -> StartedNow {
    if chat.waiting == true { return StartedNow(asks: true, text: request.map { "Needs you: \($0)" } ?? "Needs you") }
    let body = answer?.body.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if chat.running == true {
        let line: String
        if let current = answer.flatMap({ callsOf($0).last { $0.status == "running" } }) {
            line = liveLabel(current)
        } else if !body.isEmpty {
            let last = body.split(separator: "\n").last { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            line = preview(String(last ?? ""), length: 120)
        } else {
            line = "Starting…"
        }
        return StartedNow(asks: false, text: chat.provider.map { "\(agentName($0)) · \(line)" } ?? line)
    }
    let said = body.isEmpty ? "" : preview(body, length: 120)
    let ended =
        switch answer?.status {
        case "failed": "Failed"
        case "cancelled": "Stopped"
        default: "Done"
        }
    return StartedNow(asks: false, text: said.isEmpty ? ended : "\(ended): \(said)")
}

/// An agent's own answer, not a note Relay writes into the thread.
public func isAnswer(_ m: ChatMessage) -> Bool {
    m.role == "assistant" && m.compaction != true && m.handoff == nil && m.reload == nil && m.worktreeCommand == nil
}

/// What a lead's row shows of a thread it started: its latest answer and what it asks.
public struct StartedPeek: Sendable, Equatable {
    public var answer: ChatMessage?
    public var request: String?

    public init(answer: ChatMessage? = nil, request: String? = nil) {
        self.answer = answer
        self.request = request
    }

    public init(_ thread: RemoteChat) {
        answer = mainMessages(thread.messages).last(where: isAnswer)
        request = thread.requests?.first.map { $0.questions?.first?.question ?? $0.title }
    }
}
