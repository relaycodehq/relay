import Foundation

// shared/goal.ts presentGoal and shared/waiting.ts (Android's Strips.kt): what
// the strips above a thread's composer say.

public struct GoalShown: Sendable, Equatable {
    public var title: String
    public var objective: String
    public var usage: String
    public var detail: String?
    public var working: Bool
}

private let goalTitles = [
    "active": "Pursuing goal",
    "paused": "Goal paused",
    "blocked": "Goal blocked",
    "usage_limited": "Goal hit a usage limit",
    "budget_limited": "Goal reached its token budget",
    "complete": "Goal complete",
    "failed": "Goal can't be met",
]

private func goalTokens(_ value: Int64) -> String {
    if value < 1_000 { return "\(value)" }
    if value < 1_000_000 { return "\(Int64((Double(value) / 1_000).rounded()))k" }
    var m = String(format: "%.1f", Double(value) / 1_000_000)
    if m.hasSuffix(".0") { m.removeLast(2) }
    return m + "M"
}

private func goalMinutes(_ seconds: Double) -> String {
    let m = Int64(seconds / 60)
    return m < 60 ? "\(m)m" : "\(m / 60)h \(m % 60)m"
}

/// An active goal on an idle thread is set, not pursued.
public func presentGoal(_ goal: ThreadGoal, running: Bool) -> GoalShown {
    var usage: [String] = []
    if let used = goal.tokensUsed, used != 0 {
        if let budget = goal.tokenBudget, budget != 0 {
            usage.append("\(goalTokens(used)) / \(goalTokens(budget)) tokens")
        } else {
            usage.append("\(goalTokens(used)) tokens")
        }
    }
    if let time = goal.timeUsedSeconds, time >= 60 { usage.append(goalMinutes(time)) }
    if let checks = goal.checks, checks != 0 { usage.append(plural(checks, "check")) }
    let title =
        goal.status == "active" && !running
        ? (goal.gaveUp == true ? "Goal not met yet" : "Goal set") : goalTitles[goal.status] ?? goal.status
    return GoalShown(
        title: title, objective: goal.objective, usage: usage.joined(separator: " · "),
        detail: goal.status == "failed" || goal.gaveUp == true ? goal.lastCheck : nil,
        working: running && goal.status == "active")
}

/// "12s", "3m", "1h 4m": minutes are enough once it has run a while.
public func span(ms: Int64) -> String {
    let seconds = max(0, Int64((Double(ms) / 1000).rounded()))
    if seconds < 60 { return "\(seconds)s" }
    let minutes = seconds / 60
    return minutes < 60 ? "\(minutes)m" : "\(minutes / 60)h \(minutes % 60)m"
}

public func wakeupTitle(_ item: ChatPending, clock: Clock = Clock()) -> String {
    item.at.map { "Claude will check back at \(clock.clock($0))" } ?? "Claude checks back on a schedule"
}

/// How long a task has run, or how soon a wake-up comes.
public func timing(_ item: ChatPending, now: Int64) -> String? {
    if item.kind == "task" { return span(ms: now - (item.since ?? now)) }
    guard let at = item.at else { return nil }
    return at > now ? "in \(span(ms: at - now))" : "any moment"
}

/// A row in the waiting list: the command itself, or when Claude checks back.
public func pendingWhat(_ item: ChatPending, clock: Clock = Clock()) -> String {
    item.kind == "task" ? item.description ?? "" : wakeupTitle(item, clock: clock)
}

/// The waiting strip's head line: a title, then a muted detail.
public func waitingSummary(_ pending: [ChatPending], now: Int64, clock: Clock = Clock()) -> (title: String, detail: String) {
    guard let first = pending.first else { return ("", "") }
    let tasks = pending.filter { $0.kind == "task" }
    let wakeups = pending.count - tasks.count
    if first.kind == "wakeup" {
        let when = timing(first, now: now).map { " · \($0)" } ?? ""
        return (wakeupTitle(first, clock: clock), when + (pending.count > 1 ? " · +\(pending.count - 1) more" : ""))
    }
    let also = wakeups > 0 ? " · +\(wakeups) \(wakeups == 1 ? "wake-up" : "wake-ups")" : ""
    if tasks.count > 1 { return ("\(tasks.count) running in the background", also) }
    return (first.description ?? "", " · running in the background · \(timing(first, now: now) ?? "")\(also)")
}

/// "Run the A/B" reads as "…waiting on run the A/B"; acronyms keep their case.
public func lowerFirst(_ text: String) -> String {
    guard text.prefixMatch(of: #/[A-Z][a-z]/#) != nil else { return text }
    return text.prefix(1).lowercased() + text.dropFirst()
}

/// What the stopped-work strip says: Relay closed while Claude waited on something.
public func stoppedLine(_ items: [ChatPending]) -> (title: String, detail: String) {
    guard let first = items.first else { return ("", "") }
    let what = first.kind == "task" ? lowerFirst(first.description ?? "") : "a recurring wake-up"
    return ("Relay closed while Claude was waiting on \(what)", (items.count > 1 ? " · +\(items.count - 1) more" : "") + " · it stopped")
}

/// The usage-limit strip's line, or nil once it has nothing left to say: off with the limit lifted.
public func limitLine(_ plan: LimitResume, now: Int64, clock: Clock = Clock()) -> (title: String, detail: String)? {
    let due = plan.at <= now
    let off = plan.off == true
    if off && due { return nil }
    let detail =
        off ? " · resets \(clock.wakeLabel(plan.at, now: now))"
        : due ? " · resuming the answer" : " · resumes the answer at \(clock.wakeLabel(plan.at, now: now))"
    return ("\(agentName(plan.provider)) hit its usage limit", detail)
}
