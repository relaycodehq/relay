import Foundation

// shared/provider-usage.ts, context-usage.ts and thread-cost.ts; the Android
// app's composer/logic Usage.kt and ThreadContext.kt. The desktop learns the
// active hours (shared/usage-history.ts); the phone only paces the week by them.

public struct UsageWindow: Codable, Sendable, Equatable {
    public var id: String?
    public var label: String?
    /// "session" | "weekly"
    public var kind: String
    public var usedPercent: Double
    public var resetsAt: Int64?
    public var periodMs: Int64

    public init(kind: String, usedPercent: Double, resetsAt: Int64?, periodMs: Int64, id: String? = nil, label: String? = nil) {
        self.id = id
        self.label = label
        self.kind = kind
        self.usedPercent = usedPercent
        self.resetsAt = resetsAt
        self.periodMs = periodMs
    }
}

public struct UsageCredits: Codable, Sendable, Equatable {
    public var balance: Double
    public var unlimited: Bool
    public var messages: [Double]?

    public init(balance: Double, unlimited: Bool, messages: [Double]? = nil) {
        self.balance = balance
        self.unlimited = unlimited
        self.messages = messages
    }
}

/// An agent's plan limits, as `providerUsage` reports them.
public struct ProviderUsage: Codable, Sendable, Equatable {
    public var provider: String
    public var windows: [UsageWindow]
    public var message: String?
    /// How much each local hour of the day usually gets worked, 24 of them.
    public var activeHours: [Double]?
    public var credits: UsageCredits?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        provider = try c.decode(String.self, forKey: .provider)
        windows = try c.decodeIfPresent([UsageWindow].self, forKey: .windows) ?? []
        message = try c.decodeIfPresent(String.self, forKey: .message)
        activeHours = try c.decodeIfPresent([Double].self, forKey: .activeHours)
        credits = try c.decodeIfPresent(UsageCredits.self, forKey: .credits)
    }
}

/// One limit, whole percent, with how its burn is going.
public struct UsageMeter: Equatable, Sendable {
    public enum Pace: Int, Comparable, Sendable {
        case ok, warn, hot, spent
        public static func < (a: Pace, b: Pace) -> Bool { a.rawValue < b.rawValue }
    }

    public let kind: String
    public let label: String
    public let leftPercent: Int
    /// Where an even burn would leave it now.
    public let paceLeftPercent: Double?
    public let pace: Pace
    public let limitLabel: String?
    public let resetLabel: String?
}

private let fiveMinutes: Int64 = 5 * 60 * 1000
private let hourMs: Int64 = 60 * 60 * 1000
private let behindHot = 10.0

/// Rounded up to the minute, two units at most: "7m", "3h", "3h 20m", "2d 5h".
public func compactDuration(_ ms: Int64) -> String? {
    guard ms > 0 else { return nil }
    let minutes = max(1, Int64((Double(ms) / 60_000).rounded(.up)))
    let hours = minutes / 60
    if hours >= 24 { return "\(hours / 24)d \(hours % 24)h" }
    let rest = minutes % 60
    if hours == 0 { return "\(rest)m" }
    return rest != 0 ? "\(hours)h \(rest)m" : "\(hours)h"
}

public func resetsIn(_ at: Int64, now: Int64) -> String? {
    if at - now <= fiveMinutes { return "Resets soon" }
    return compactDuration(at - now).map { "Resets in \($0)" }
}

private func outIn(_ ms: Int64) -> String? {
    if ms <= fiveMinutes { return "Out soon" }
    return compactDuration(ms).map { "Out in ~\($0)" }
}

private func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }

private func calendar(_ zone: TimeZone) -> Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = zone
    return c
}

private func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

/// Start of the next local hour, which half-hour time zones don't align.
public func nextHour(_ t: Int64, zone: TimeZone = .current) -> Int64 {
    guard let hour = calendar(zone).dateInterval(of: .hour, for: date(t)) else { return t + hourMs }
    let next = Int64((hour.end.timeIntervalSince1970 * 1000).rounded())
    return next > t ? next : t + hourMs
}

/// Hours of usual work between two moments, each local hour weighted by the profile.
public func activeWeight(_ profile: [Double], from: Int64, to: Int64, zone: TimeZone = .current) -> Double {
    let cal = calendar(zone)
    var total = 0.0
    var t = from
    while t < to {
        let next = min(to, nextHour(t, zone: zone))
        let hour = cal.component(.hour, from: date(t))
        total += (profile.indices.contains(hour) ? profile[hour] : 0) * Double(next - t) / Double(hourMs)
        t = next
    }
    return total
}

/// Time that counts toward a limit's burn between two moments.
private typealias BurnClock = (_ from: Int64, _ to: Int64) -> Double

private func clockFor(_ window: UsageWindow, _ activeHours: [Double]?, _ zone: TimeZone) -> BurnClock? {
    // Only the week spans nights and weekends; a session is all working time.
    guard window.kind == "weekly", let activeHours, activeHours.count == 24 else { return nil }
    return { from, to in activeWeight(activeHours, from: from, to: to, zone: zone) * Double(hourMs) }
}

private func paceLeft(_ clock: BurnClock, start: Int64, end: Int64, now: Int64) -> Double? {
    let total = clock(start, end)
    guard total > 0 else { return nil }
    return clamp(clock(max(now, start), end) / total * 100, 0, 100)
}

/// Whole-percent meter for one usage window, including the pace warning. With
/// the hours someone usually works, the week's burn and pace only count those.
public func presentWindow(_ window: UsageWindow, now: Int64, activeHours: [Double]? = nil, zone: TimeZone = .current)
    -> UsageMeter
{
    let used = clamp(window.usedPercent, 0, 100)
    let left = Int(clamp((100 - used).rounded(), 0, 100))
    let label = window.label ?? (window.kind == "session" ? "Session" : "Weekly")
    let fresh = window.kind == "session" && window.resetsAt == nil && used <= 0
    let resetLabel = fresh ? "Not started" : window.resetsAt.flatMap { resetsIn($0, now: now) }
    let active = clockFor(window, activeHours, zone)
    let clock: BurnClock = active ?? { from, to in Double(to - from) }
    let paceLeft = window.resetsAt.flatMap { paceLeft(clock, start: $0 - window.periodMs, end: $0, now: now) }
    func meter(_ left: Int, _ pace: UsageMeter.Pace, _ limit: String?) -> UsageMeter {
        UsageMeter(
            kind: window.kind, label: label, leftPercent: left, paceLeftPercent: fresh ? nil : paceLeft, pace: pace,
            limitLabel: limit, resetLabel: resetLabel)
    }
    if fresh { return meter(100, .ok, nil) }
    if left <= 0 { return meter(0, .spent, "Limit reached") }
    switch project(used, window, now: now, clock, learned: active != nil, zone: zone) {
    case .ahead?:
        return meter(left, .ok, nil)
    case .onTrack(let projected)?:
        let spare = Int((100 - projected).rounded())
        return meter(left, spare >= 1 ? .warn : .hot, spare >= 1 ? "~\(spare)% spare" : nil)
    case .behind(let eta)?:
        // A few points past the pace mark is one lighter afternoon, not a fire.
        let behind = (paceLeft ?? 100) - Double(left)
        return meter(left, behind >= behindHot ? .hot : .warn, eta.flatMap(outIn))
    case nil:
        let percent = Int(used.rounded())
        return meter(left, percent >= 90 ? .hot : percent >= 80 ? .warn : .ok, nil)
    }
}

private enum Projection {
    case ahead
    case onTrack(projected: Double)
    case behind(eta: Int64?)
}

private func project(
    _ used: Double, _ window: UsageWindow, now: Int64, _ clock: BurnClock, learned: Bool, zone: TimeZone
) -> Projection? {
    guard let resetsAt = window.resetsAt else { return nil }
    let period = window.periodMs
    if used <= 0 || period <= 0 || now >= resetsAt { return nil }
    let elapsed = clock(resetsAt - period, now)
    // Learned hours already skip nights, so an hour of real work is enough.
    let minElapsed = learned ? Double(hourMs) : max(60_000, Double(period) * 0.01)
    if elapsed < minElapsed { return nil }
    let rate = used / elapsed
    let projected = used + rate * clock(now, resetsAt)
    if used >= 100 || projected > 100 {
        return used < 5 ? nil : .behind(eta: runsOutIn(used, rate, now: now, resetsAt: resetsAt, clock, zone: zone))
    }
    if projected <= 90 { return .ahead }
    return used < 5 ? nil : .onTrack(projected: projected)
}

/// Wall time until the limit is hit at this rate, if before the reset.
private func runsOutIn(_ used: Double, _ rate: Double, now: Int64, resetsAt: Int64, _ clock: BurnClock, zone: TimeZone)
    -> Int64?
{
    let need = 100 - used
    guard rate > 0 else { return nil }
    if need <= 0 { return 0 }
    // Both clocks run evenly within an hour, so solve one hour at a time.
    var spent = 0.0
    var t = now
    while t < resetsAt {
        let next = min(resetsAt, nextHour(t, zone: zone))
        let burn = rate * clock(t, next)
        if spent + burn >= need {
            let at = Double(t) + (need - spent) / burn * Double(next - t)
            return Int64(((at - Double(now)) / 1000).rounded()) * 1000
        }
        spent += burn
        t = next
    }
    return nil
}

/// "5% ahead" with more left than an even burn would leave, "3% behind" running hot.
public func paceGap(_ meter: UsageMeter) -> String? {
    guard let pace = meter.paceLeftPercent, meter.pace != .spent else { return nil }
    let gap = meter.leftPercent - Int(pace.rounded())
    return gap == 0 ? "On pace" : gap > 0 ? "\(gap)% ahead" : "\(-gap)% behind"
}

/// The meters for what an agent reported.
public func usageMeters(_ usage: ProviderUsage?, now: Int64, zone: TimeZone = .current) -> [UsageMeter] {
    usage?.windows.map { presentWindow($0, now: now, activeHours: usage?.activeHours, zone: zone) } ?? []
}

/// "Session 40% left, Weekly 80% left", and whether it runs hot, for a screen reader.
public func usageLabel(_ meters: [UsageMeter]) -> String? {
    guard let worst = meters.map(\.pace).max() else { return nil }
    return meters.map { "\($0.label) \($0.leftPercent)% left" }.joined(separator: ", ")
        + (worst == .ok ? "" : ", running hot")
}

private func grouped(_ n: Double) -> String {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "en_US")
    f.numberStyle = .decimal
    f.maximumFractionDigits = 0
    return f.string(from: NSNumber(value: n.rounded())) ?? "\(Int(n.rounded()))"
}

public func creditsLabel(_ c: UsageCredits) -> String {
    c.unlimited ? "Unlimited credits" : "\(grouped(c.balance)) credits"
}

public func creditsReach(_ c: UsageCredits) -> String? {
    guard let m = c.messages, m.count == 2, !c.unlimited else { return nil }
    let low = grouped(m[0])
    let high = grouped(m[1])
    return low == high ? "~\(low) messages" : "~\(low)–\(high) messages"
}

/// Agents that report their plan's limits.
public func reportsUsage(_ provider: String) -> Bool { agentTraits(provider)?.usage == true }

// MARK: What a conversation holds

/// The newest reported usage on this branch, unless a compaction or another agent reset it since.
public func latestContext(_ messages: [ChatMessage]) -> ContextUsage? {
    var holder: String?
    for m in messages.reversed() {
        if m.role != "assistant" || m.reload != nil || m.worktreeCommand != nil { continue }
        if m.handoff != nil { return nil }
        if holder == nil { holder = m.provider }
        if m.provider != holder { return nil }
        if let context = m.context { return context }
        if m.compaction == true && m.status == "complete" { return nil }
    }
    return nil
}

/// How full the context window is, whole percent; nil when its size isn't known.
public func contextPercent(_ context: ContextUsage?) -> Int? {
    guard let context, let max = context.maxTokens, max > 0 else { return nil }
    return min(100, Int((Double(context.usedTokens) * 100 / Double(max)).rounded()))
}

/// What the answers in it were billed, per model, priciest first.
public func threadCost(_ messages: [ChatMessage]) -> ThreadCost? {
    var byModel: [(name: String, usd: Double)] = []
    var usd = 0.0
    var answers = 0
    for m in messages {
        guard let cost = m.cost, cost > 0 else { continue }
        usd += cost
        answers += 1
        let name = m.model.flatMap { $0.name.isEmpty ? nil : $0.name } ?? "Default model"
        if let at = byModel.firstIndex(where: { $0.name == name }) { byModel[at].usd += cost } else {
            byModel.append((name, cost))
        }
    }
    guard answers > 0 else { return nil }
    return ThreadCost(
        usd: usd, answers: answers,
        models: byModel.map { ModelCost(name: $0.name, usd: $0.usd) }.sorted { $0.usd > $1.usd })
}

public extension RemoteClient {
    /// The agent's plan limits; `force` asks the agent again rather than the desktop's copy.
    func providerUsage(_ provider: String, force: Bool) async throws -> ProviderUsage {
        try await desktop("providerUsage", [.string(provider), .bool(force)]).decode()
    }
}
