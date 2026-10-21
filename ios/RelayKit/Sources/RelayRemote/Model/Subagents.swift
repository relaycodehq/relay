import Foundation

// shared/subagents.ts (Android's SubagentWords.kt and SubagentPoll.kt): the
// subagents a thread's agent started, as the strip, its sheet and a run's
// screen show them. From `Bridge.subagents`.

public struct SubagentRun: Codable, Sendable, Equatable, Identifiable {
    /// The Agent tool call that started it.
    public var id: String
    /// Its background task, which the thread's pending work lists too.
    public var taskId: String?
    public var description: String
    public var type: String?
    public var model: String?
    public var brief: String?
    /// "running" | "completed" | "failed" | "stopped"
    public var status: String
    public var canStop: Bool?
    public var started: Int64
    public var ended: Int64?
    /// Its latest ~30s progress summary, while it runs.
    public var summary: String?
    public var calls: Int
    /// The last few calls, newest last.
    public var recent: [AgentActivity]
    public var outcome: String?
    public var parentId: String?
    public var provider: String?
    /// Only in a run read with `subagentRun`.
    public var trace: [AgentTrace]?
    public var report: String?

    public var running: Bool { status == "running" }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        description = try c.decode(String.self, forKey: .description)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        brief = try c.decodeIfPresent(String.self, forKey: .brief)
        status = try c.decode(String.self, forKey: .status)
        canStop = try c.decodeIfPresent(Bool.self, forKey: .canStop)
        started = try c.decode(Int64.self, forKey: .started)
        ended = try c.decodeIfPresent(Int64.self, forKey: .ended)
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        calls = try c.decodeIfPresent(Int.self, forKey: .calls) ?? 0
        recent = try c.decodeIfPresent([AgentActivity].self, forKey: .recent) ?? []
        outcome = try c.decodeIfPresent(String.self, forKey: .outcome)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        provider = try c.decodeIfPresent(String.self, forKey: .provider)
        trace = try c.decodeIfPresent([AgentTrace].self, forKey: .trace)
        report = try c.decodeIfPresent(String.self, forKey: .report)
    }
}

public struct SubagentList: Codable, Sendable, Equatable {
    public var signature: String
    public var runs: [SubagentRun]
}

/// `run` is nil for a session that is gone.
public struct SubagentRunAnswer: Codable, Sendable, Equatable {
    public var signature: String
    public var run: SubagentRun?
}

public extension RemoteClient {
    /// The thread's subagents; nil when nothing changed since `known`.
    func subagents(chatId: String, known: String?) async throws -> SubagentList? {
        let answer = try await call("subagents", [.string(chatId), known.map(JSON.string)])
        return answer == .null ? nil : try answer.decode()
    }

    /// One agent's whole run; nil when nothing changed since `known`.
    func subagentRun(chatId: String, agentId: String, known: String?) async throws -> SubagentRunAnswer? {
        let answer = try await call("subagentRun", [.string(chatId), .string(agentId), known.map(JSON.string)])
        return answer == .null ? nil : try answer.decode()
    }

    /// Stops one agent; its lead's turn and the others carry on.
    func stopAgent(chatId: String, agentId: String) async throws {
        _ = try await desktop("stopProjectChatAgent", [.string(chatId), .string(agentId)])
    }
}

/// Working agents first, each group in the order they started.
public func bySubagentStanding(_ a: SubagentRun, _ b: SubagentRun) -> Bool {
    if a.running != b.running { return a.running }
    return a.started < b.started
}

/// Runs that overlapped in time, oldest first: one fan-out each.
public func subagentBatches(_ runs: [SubagentRun], now: Int64) -> [[SubagentRun]] {
    var batches: [[SubagentRun]] = []
    var until = Int64.min
    for run in runs.sorted(by: { $0.started < $1.started }) {
        if run.started > until || batches.isEmpty { batches.append([]) }
        batches[batches.count - 1].append(run)
        until = max(until, run.running ? now : run.ended ?? run.started)
    }
    return batches
}

/// Every agent that overlapped the ones still running; empty once they're all back.
public func runningBatch(_ runs: [SubagentRun], now: Int64) -> [SubagentRun] {
    guard let last = subagentBatches(runs, now: now).last, last.contains(where: \.running) else { return [] }
    return last
}

/// The thread's background work minus the agents the strip already shows.
public func outsideBatch(_ pending: [ChatPending], _ batch: [SubagentRun]) -> [ChatPending] {
    let shown = Set(batch.compactMap(\.taskId))
    return pending.filter { !shown.contains($0.id) }
}

/// "claude-opus-5-5" reads "Opus 5.5"; an alias like "haiku" reads "Haiku".
public func modelName(_ model: String) -> String {
    func cap(_ w: Substring) -> String { w.prefix(1).uppercased() + w.dropFirst() }
    if let m = model.wholeMatch(of: #/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[1m\])?/#) {
        return "\(cap(m.output.1)) \(m.output.2)\(m.output.3.map { ".\($0)" } ?? "")"
    }
    return model.wholeMatch(of: #/[a-z]+/#) != nil ? cap(model[...]) : model
}

/// "26s", "4m 05s", "1h 03m".
public func took(ms: Int64) -> String {
    let s = max(0, ms / 1000)
    if s < 60 { return "\(s)s" }
    let m = s / 60
    if m < 60 { return "\(m)m \(String(format: "%02d", s % 60))s" }
    return "\(m / 60)h \(String(format: "%02d", m % 60))m"
}

/// "Explore agent", or just "Agent" for the default kind.
public func agentKind(_ run: SubagentRun) -> String {
    guard let type = run.type, !type.isEmpty, type != "general-purpose", type != "general" else { return "Agent" }
    return type.prefix(1).uppercased() + type.dropFirst() + " agent"
}

/// The thread's agent that started it and reads what it reports.
public func leadName(_ run: SubagentRun) -> String { agentName(run.provider ?? "claude") }

/// What it's on now, from its ~30s summary, or how it ended.
public func subagentNow(_ run: SubagentRun) -> String {
    if run.running {
        return run.summary ?? run.recent.last(where: { $0.status == "running" }).map(liveLabel) ?? "Starting…"
    }
    // Its first sentence: up to a full stop with a space after it.
    let outcome = run.outcome.map { text in
        text.firstMatch(of: #/\.\s/#).map { String(text[..<$0.range.lowerBound]) + "." } ?? text
    }
    if run.status == "idle" { return outcome ?? "Child status unavailable" }
    if run.status == "completed" { return outcome ?? "Done" }
    return run.status == "failed" ? "Failed" : "Stopped"
}

/// "Agent · Opus 5.5 · 12 calls", under a run's name.
public func subagentAbout(_ run: SubagentRun) -> String {
    [agentKind(run), run.model.map(modelName), plural(run.calls, "call")].compactMap { $0 }.joined(separator: " · ")
}

/// The run as a turn of its own, for the trace to draw.
public func subagentMessage(_ run: SubagentRun) -> ChatMessage {
    let status =
        switch run.status {
        case "running": "streaming"
        case "stopped": "cancelled"
        case "failed": "failed"
        default: "complete"
        }
    var fields: [String: JSON] = [
        "id": .string("agent:\(run.id)"), "role": "assistant", "body": .string(run.report ?? ""),
        "status": .string(status), "created": .number(Double(run.started)),
        "provider": .string(run.provider ?? "claude"), "version": 1,
    ]
    if let ended = run.ended { fields["ended"] = .number(Double(ended)) }
    if let trace = run.trace, let json = try? JSON(encoding: trace) { fields["trace"] = json }
    // Built from known fields, so it decodes.
    return try! JSON.object(fields).decode()
}

/// The next wait after a conditional read: back to 5s on news, doubling to 20s
/// without, to 60s after failures (nil).
public func nextPollDelay(_ ms: Int64, changed: Bool?) -> Int64 {
    switch changed {
    case true?: 5_000
    case false?: min(ms * 2, 20_000)
    case nil: min(ms * 2, 60_000)
    }
}
