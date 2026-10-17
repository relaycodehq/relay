import Foundation

// Android's ChatActivity.kt, StartedFamilies.kt and Triage.kt (shared/chat-activity.ts,
// started-families.ts and projects/threads.ts's ChatTriage): how Home sorts threads, and
// what a swipe or the hold menu asks of the desktop.

public struct ActivitySections: Sendable, Equatable {
    public var active: [RemoteChatSummary] = []
    public var snoozed: [RemoteChatSummary] = []
    public var settled: [RemoteChatSummary] = []
}

public func chatSettled(_ chat: RemoteChatSummary) -> Bool {
    guard chat.waiting != true, let settledAt = chat.settledAt else { return false }
    // Settled mid-answer: the answer it waits for moves `updated` past it.
    if chat.settleWhenDone != nil { return true }
    return chat.running != true && settledAt >= chat.updated
}

public func chatSnoozed(_ chat: RemoteChatSummary, now: Int64) -> Bool { (chat.snoozedUntil ?? 0) > now }

/// Only the latest settled threads stay in Activity; Projects lists them all.
private let settledShelf = 15

public func chatActivitySections(_ chats: [RemoteChatSummary], now: Int64) -> ActivitySections {
    var out = ActivitySections()
    for chat in chats {
        if chatSettled(chat) { out.settled.append(chat) }
        else if chatSnoozed(chat, now: now) { out.snoozed.append(chat) }
        else { out.active.append(chat) }
    }
    // Latest settled first: one settled just now stays there to undo.
    out.settled = Array(out.settled.sorted { ($0.settledAt ?? 0) > ($1.settledAt ?? 0) }.prefix(settledShelf))
    return out
}

/// Only blocking requests or questions left after the turn stops end an orchestration wait.
public func inputBlocksThread(_ chat: RemoteChatSummary) -> Bool {
    chat.waiting == true && (chat.running != true || chat.asking != true || chat.blocked == true)
}

/// When the oldest background agent still going started, if any.
public func agentsSince(_ pending: [ChatPending]?) -> Int64? {
    (pending ?? []).filter { $0.kind == "task" && $0.agent == true }.compactMap(\.since).min()
}

public struct ActivityGroup: Sendable, Equatable {
    public var label: String
    public var chats: [RemoteChatSummary]
}

/// Open threads split as you'd triage them: the ones waiting on you, the ones still working,
/// then the rest. A lead counts as needing you when a thread it started does.
public func groupByState(_ top: [RemoteChatSummary], started: [String: [RemoteChatSummary]]) -> [ActivityGroup] {
    var needs: [RemoteChatSummary] = [], running: [RemoteChatSummary] = [], rest: [RemoteChatSummary] = []
    for chat in top {
        let family = [chat] + (started[chat.id] ?? [])
        if family.contains(where: { inputBlocksThread($0) || $0.waiting == true }) { needs.append(chat) }
        else if family.contains(where: { $0.running == true || agentsSince($0.pending) != nil }) { running.append(chat) }
        else { rest.append(chat) }
    }
    return [.init(label: "Needs you", chats: needs), .init(label: "Running", chats: running), .init(label: "Recent", chats: rest)]
}

/// How long a running turn has gone, by the second: "26s", "4m 12s", "1h 3m".
public func elapsedLabel(_ since: Int64, now: Int64) -> String {
    let seconds = max(0, (now - since) / 1000)
    if seconds < 60 { return "\(seconds)s" }
    if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
    return "\(seconds / 3600)h \((seconds / 60) % 60)m"
}

/// Compact age for rows: "now", "4m", "3h", "2d", "5w".
public func shortAge(_ then: Int64, now: Int64) -> String {
    let minutes = max(0, (now - then) / 60_000)
    if minutes < 1 { return "now" }
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }
    let days = hours / 24
    if days < 7 { return "\(days)d" }
    return "\(days / 7)w"
}

public struct SnoozePreset: Sendable, Equatable {
    public var id: String
    public var label: String
    public var until: Int64
}

private let hourMs: Int64 = 3_600_000

extension Clock {
    /// Local `hour`:00 `days` calendar days after `from`; calendar days keep the hour across DST.
    func dayAt(_ from: Date, days: Int, hour: Int) -> Int64 {
        let day = calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: from)) ?? from
        let at = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
        return Int64((at.timeIntervalSince1970 * 1000).rounded())
    }

    public func snoozePresets(_ now: Int64) -> [SnoozePreset] {
        let at = Date(timeIntervalSince1970: Double(now) / 1000)
        // 0 = Sunday, as JS's getDay. A Monday waits for the next one, and so does a Sunday,
        // whose coming Monday is already Tomorrow.
        let jsDay = calendar.component(.weekday, from: at) - 1
        let toMonday = jsDay == 0 ? 8 : 7 - ((jsDay + 6) % 7)
        var presets = [
            SnoozePreset(id: "quarter", label: "15 minutes", until: now + hourMs / 4),
            SnoozePreset(id: "hour", label: "1 hour", until: now + hourMs),
            SnoozePreset(id: "three-hours", label: "3 hours", until: now + 3 * hourMs),
        ]
        // Past five the evening is too close to be worth a choice of its own.
        if calendar.component(.hour, from: at) < 17 {
            presets.append(SnoozePreset(id: "evening", label: "This evening", until: dayAt(at, days: 0, hour: 18)))
        }
        presets.append(SnoozePreset(id: "tomorrow", label: "Tomorrow", until: dayAt(at, days: 1, hour: 9)))
        presets.append(SnoozePreset(id: "next-week", label: "Next week", until: dayAt(at, days: toMonday, hour: 9)))
        return presets
    }
}

public struct LaterPreset: Sendable, Equatable {
    public var label: String
    public var at: Int64
}

extension Clock {
    /// shared/chat-activity.ts sendLaterPresets: when a message set for later goes.
    public func sendLaterPresets(_ now: Int64) -> [LaterPreset] {
        let at = Date(timeIntervalSince1970: Double(now) / 1000)
        var presets = [
            LaterPreset(label: "In 30 minutes", at: now + hourMs / 2),
            LaterPreset(label: "In 1 hour", at: now + hourMs),
            LaterPreset(label: "In 3 hours", at: now + 3 * hourMs),
        ]
        if calendar.component(.hour, from: at) < 17 {
            presets.append(LaterPreset(label: "This evening", at: dayAt(at, days: 0, hour: 18)))
        }
        presets.append(LaterPreset(label: "Tomorrow morning", at: dayAt(at, days: 1, hour: 9)))
        return presets
    }
}

public struct RuntimeMode: Sendable, Equatable {
    public var value: String
    public var label: String
    public var description: String
}

/// The desktop's permission modes, least trusting first.
public let runtimeModes = [
    RuntimeMode(value: "approval-required", label: "Supervised", description: "Asks before running commands or changing files."),
    RuntimeMode(value: "auto-accept-edits", label: "Auto-accept edits", description: "Edits files freely, asks before anything else."),
    RuntimeMode(value: "auto", label: "Auto", description: "The agent's own reviewer clears routine actions; agents without one ask."),
    RuntimeMode(value: "full-access", label: "Full access", description: "Runs commands and edits files without asking."),
]

public func modeLabel(_ mode: String) -> String { runtimeModes.first { $0.value == mode }?.label ?? mode }

// MARK: Started families

private func startedRank(_ c: RemoteChatSummary) -> Int { c.waiting == true ? 0 : c.running == true ? 1 : 2 }

/// Needs the user first, then working, then done; each oldest first.
func byStanding(_ a: RemoteChatSummary, _ b: RemoteChatSummary) -> Bool {
    (startedRank(a), a.created) < (startedRank(b), b.created)
}

public struct StartedFamilies: Sendable, Equatable {
    /// Cards in order, with settled leads coming back as headers above their threads.
    public var top: [RemoteChatSummary]
    /// `top` without those headers.
    public var cards: [RemoteChatSummary]
    public var started: [String: [RemoteChatSummary]]
    /// Settled leads shown as headers, which the Settled shelf leaves out.
    public var headers: Set<String>
}

/// Threads another thread's agent started sit under their lead.
public func startedFamilies(_ active: [RemoteChatSummary], settled: [RemoteChatSummary] = []) -> StartedFamilies {
    let listed = Set(active.map(\.id))
    let resting = Dictionary(settled.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    var started: [String: [RemoteChatSummary]] = [:]
    for c in active {
        if let lead = c.startedBy?.chatId, !lead.isEmpty, listed.contains(lead) || resting[lead] != nil {
            started[lead, default: []].append(c)
        }
    }
    started = started.mapValues { $0.sorted(by: byStanding) }
    var top: [RemoteChatSummary] = []
    var headers = Set<String>()
    for c in active {
        let lead = c.startedBy?.chatId ?? ""
        if started[lead] == nil { top.append(c) }
        else if let header = resting[lead], headers.insert(lead).inserted { top.append(header) }
    }
    return StartedFamilies(top: top, cards: top.filter { !headers.contains($0.id) }, started: started, headers: headers)
}

/// "4 threads · 1 working · 1 needs you", on the lead's card.
public func familyLine(_ started: [RemoteChatSummary]) -> String {
    let asking = started.count(where: { $0.waiting == true })
    let working = started.count(where: { $0.running == true && !inputBlocksThread($0) })
    var parts = ["\(started.count) thread\(started.count == 1 ? "" : "s")"]
    if working > 0 { parts.append("\(working) working") }
    if asking > 0 { parts.append("\(asking) need\(asking == 1 ? "s" : "") you") }
    if working == 0 && asking == 0 { parts.append("all done") }
    return parts.joined(separator: " · ")
}

/// Every thread in the family is done and read: it folds until something happens.
public func familySettled(_ started: [RemoteChatSummary], unread: (RemoteChatSummary) -> Bool) -> Bool {
    started.allSatisfy { $0.running != true && $0.waiting != true && ($0.pending ?? []).isEmpty && !unread($0) }
}

/// How the user left each started-threads family; a family never toggled is missing.
public struct FamilyFolds: Codable, Sendable, Equatable {
    /// Oldest toggle first.
    public private(set) var leads: [String] = []
    public private(set) var open: [String: Bool] = [:]

    public init() {}

    /// How many toggled families are remembered, so leads long gone don't pile up.
    static let keep = 200

    public subscript(lead: String) -> Bool? { open[lead] }

    /// `lead` set, moved to the newest end and the oldest past the cap dropped.
    public mutating func fold(_ lead: String, open isOpen: Bool) {
        leads.removeAll { $0 == lead }
        leads.append(lead)
        open[lead] = isOpen
        while leads.count > Self.keep { open[leads.removeFirst()] = nil }
    }
}

// MARK: Triage

/// shared/projects/threads.ts's ChatTriage, the subset the phone sends from Home.
public enum TriageAction: Sendable, Equatable {
    case settle
    /// Settles once the running answer ends.
    case settleWhenDone
    case snooze(until: Int64)
    case wake
    case unsettle
    case unread
    case archive
    case restore(from: [String: Int64], to: [String: Int64])

    public var json: JSON {
        func marks(_ m: [String: Int64]) -> JSON { .object(m.mapValues { .number(Double($0)) }) }
        return switch self {
        case .settle: ["kind": "settle"]
        case .settleWhenDone: ["kind": "settle-when-done"]
        case .snooze(let until): ["kind": "snooze", "until": .number(Double(until))]
        case .wake: ["kind": "wake"]
        case .unsettle: ["kind": "unsettle"]
        case .unread: ["kind": "unread"]
        case .archive: ["kind": "archive"]
        case .restore(let from, let to): ["kind": "restore", "from": marks(from), "to": marks(to)]
        }
    }
}

private let triageKeys = ["settledAt", "settleWhenDone", "unsettledAt", "snoozedAt", "snoozedUntil", "archivedAt"]

/// The marks triage set on a desktop ChatSummary; a settle worked out live isn't one.
public func triageState(_ chat: JSON) -> [String: Int64] {
    let autoSettled = chat["autoSettled"]?.bool == true
    var out: [String: Int64] = [:]
    for key in triageKeys {
        guard let value = chat[key]?.number else { continue }
        if key == "settledAt" && autoSettled { continue }
        out[key] = Int64(value)
    }
    return out
}

/// Takes back a settle or snooze made from the phone, as the desktop's ⌘Z does. The phone's list
/// doesn't carry `unsettledAt`/`archivedAt`, so those come from what the desktop answered.
public func undoTriage(_ before: RemoteChatSummary, after: JSON) -> TriageAction {
    let from = triageState(after)
    var to: [String: Int64] = [:]
    if let v = from["unsettledAt"], v != 0 { to["unsettledAt"] = v }
    if let v = from["archivedAt"], v != 0 { to["archivedAt"] = v }
    if before.autoSettled != true, let v = before.settledAt, v != 0 { to["settledAt"] = v }
    if let until = before.snoozedUntil, until != 0 {
        if let at = before.snoozedAt { to["snoozedAt"] = at }
        to["snoozedUntil"] = until
    }
    return .restore(from: from, to: to)
}

public extension RemoteClient {
    func rename(chatId: String, to name: String) async throws {
        _ = try await desktop("renameProjectChat", [.string(chatId), .string(name)])
    }

    /// A fresh name from the conversation so far. From `Bridge.title`.
    func regenerateTitle(chatId: String) async throws {
        _ = try await desktop("regenerateProjectChatTitle", [.string(chatId)])
    }

    /// The agent summarises the conversation, or a side one, to free up its context;
    /// `instructions` say what to keep.
    func compact(chatId: String, rootId: String? = nil, instructions: String = "") async throws {
        var args: [JSON?] = [.string(chatId), rootId.map(JSON.string)]
        if !instructions.isEmpty { args.append(.string(instructions)) }
        _ = try await desktop("compactProjectChat", args)
    }

    /// `triageProjectChat`: the thread as the desktop left it, for an Undo.
    func triage(chatId: String, _ action: TriageAction) async throws -> JSON {
        try await desktop("triageProjectChat", [.string(chatId), action.json])
    }
}
