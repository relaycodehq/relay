import Foundation

// shared/agent-trace.ts: how an agent turn reads while it runs and once it ends.

/// A turn's events in order; saves from before traces kept only the calls.
func traceOf(_ message: ChatMessage) -> [AgentTrace] {
    message.trace ?? (message.activity ?? []).map { AgentTrace(kind: "activity", id: $0.id, text: nil, activity: $0) }
}

public enum TracePart: Identifiable, Sendable, Equatable {
    case commentary(id: String, text: String)
    case run(id: String, activity: [AgentActivity])

    public var id: String {
        switch self {
        case .commentary(let id, _), .run(let id, _): id
        }
    }
}

/// Consecutive calls become one run; commentary splits them, and a question to
/// you stands as a run of its own.
public func groupTrace(_ entries: [AgentTrace]) -> [TracePart] {
    var parts: [TracePart] = []
    for entry in entries {
        guard let activity = entry.activity, entry.kind == "activity" else {
            parts.append(.commentary(id: entry.id, text: entry.text ?? ""))
            continue
        }
        if case .run(let id, var run)? = parts.last, !isQuestionCall(activity), !isQuestionCall(run[0]) {
            run.append(activity)
            parts[parts.count - 1] = .run(id: id, activity: run)
        } else {
            parts.append(.run(id: entry.id, activity: [activity]))
        }
    }
    return parts
}

/// Everything a turn's heading and trace are drawn from.
public struct Turn: Sendable, Equatable {
    public var live: Bool
    /// The trace without the calls subagents made.
    public var shown: [AgentTrace]
    /// Subagents' calls, by the agent call that ran them.
    public var calls: [String: [AgentActivity]]
    /// The agent's own calls.
    public var activity: [AgentActivity]
    public var current: AgentActivity?
    /// Between calls with nothing written yet.
    public var thinking: Bool

    public init(_ message: ChatMessage) {
        live = message.status == "streaming"
        let entries = traceOf(message)
        let ids = Set(entries.map(\.id))
        var calls: [String: [AgentActivity]] = [:]
        shown = entries.filter { e in
            // An orphan, its agent row dropped from a full trace, stays in line.
            guard e.kind == "activity", let a = e.activity, let parent = a.parentId, ids.contains(parent) else { return true }
            calls[parent, default: []].append(a)
            return false
        }
        self.calls = calls
        activity = shown.compactMap { $0.kind == "activity" ? $0.activity : nil }
        current = live ? activity.last { $0.status == "running" } : nil
        thinking = live && current == nil && message.body.isEmpty
    }
}

/// What a turn's heading says. Open while live it's the whole run; folded, it
/// stands in for the one live row.
public enum TurnHeading: Sendable, Equatable {
    case working
    case call(AgentActivity)
    case writing
    case thinking
    case done(text: String)
}

public func turnHeading(_ message: ChatMessage, expanded: Bool, turn: Turn? = nil) -> TurnHeading {
    let turn = turn ?? Turn(message)
    if !turn.live {
        if let summary = message.stepsSummary { return .done(text: summary) }
        let text = summarizeActivity(turn.activity, dropped: message.traceDropped ?? [:])
        return .done(text: text.isEmpty ? "Thought" : text)
    }
    if expanded { return .working }
    if let current = turn.current { return .call(current) }
    return message.body.isEmpty ? .thinking : .writing
}

/// The line under a stopped turn, which claims output was kept only when there is some.
public func stoppedNote(_ message: ChatMessage) -> String {
    !message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !traceOf(message).isEmpty
        || !(message.changes ?? []).isEmpty
        ? "Stopped · partial output kept" : "Stopped"
}

private let thinkingWords = [
    "Thinking", "Pondering", "Mulling it over", "Noodling", "Ruminating", "Percolating", "Cogitating", "Brewing",
    "Tinkering", "Musing", "Scheming", "Untangling", "Marinating", "Puzzling", "Chewing on it", "Connecting dots",
]

/// The turn's word for this six-second window, the same on every redraw.
public func thinkingWord(_ seed: String, now: Int64) -> String {
    var h: Int32 = 7
    for unit in "\(seed):\(now / 6000)".utf16 { h = h &* 31 &+ Int32(unit) }
    return thinkingWords[Int(UInt32(bitPattern: h) % UInt32(thinkingWords.count))]
}
