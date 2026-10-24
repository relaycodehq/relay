import Foundation

/// What can happen to a message waiting in a thread's queue.
public enum QueueAction: Sendable, Equatable {
    /// Out now: into the running answer, or as the next turn.
    case steer
    case remove
    case move(to: Int)
}

/// What taking a queued message back puts in the composer: its text without
/// the agent mention (the picker holds the agent), and what it went with.
/// A note keeps its text whole and leaves the composer's agent alone.
public struct TakenBack: Sendable, Equatable {
    public var body: String
    public var settings: ResumeSettings?

    public init(_ item: RemoteQueued) {
        let to = item.to ?? agentMention(item.body)
        body = to == "message" ? item.body : withoutAgentMention(item.body)
        if var settings = item.settings, let to, to != "message" {
            settings.provider = to
            self.settings = settings
        }
    }
}

/// What waits in the queue list: everything but the steers held a moment, which show as sent.
public func waitingInQueue(_ queue: [RemoteQueued]?) -> [RemoteQueued] {
    (queue ?? []).filter { $0.held != true }
}

/// The steers held a moment in this conversation, as the messages they become.
public func heldSteers(_ queue: [RemoteQueued]?, rootId: String? = nil, now: Int64) -> [ChatMessage] {
    (queue ?? []).filter { $0.held == true && $0.parentId == rootId }.map { item in
        ChatMessage(
            id: item.id, role: "user", body: item.body, status: "complete", created: item.created ?? now,
            provider: item.to ?? item.settings?.provider ?? "claude", version: 0, parentId: item.parentId)
    }
}

/// The line under a queued message: why it's stuck, or when it goes, and its screenshots.
/// A paused queue says so on its first message, rather than in a line of its own.
public func queuedStatus(
    _ item: RemoteQueued, index: Int, later: Bool, paused: Bool, compacting: Bool, now: Int64,
    clock: Clock = Clock()
) -> String {
    if let error = item.error { return error }
    let when =
        if later, let at = item.at { "Sends \(clock.wakeLabel(at, now: now))" }
        else if index == 0 && paused { "Paused · send one now to carry on" }
        else if index == 0 { compacting ? "Sends after compaction" : "Next" }
        else { "Queued" }
    guard let images = item.images, images > 0 else { return when }
    return "\(when) · \(images) \(images == 1 ? "image" : "images")"
}

extension Clock {
    /// When something set for later goes: "14:30", "tomorrow 9:00", "Fri 9:00", "Nov 3, 9:00".
    public func wakeLabel(_ until: Int64, now: Int64) -> String {
        let at = Date(timeIntervalSince1970: Double(until) / 1000)
        let ahead =
            calendar.dateComponents(
                [.day], from: calendar.startOfDay(for: Date(timeIntervalSince1970: Double(now) / 1000)),
                to: calendar.startOfDay(for: at)
            ).day ?? 0
        let t = clock(until)
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = locale
        if ahead <= 0 { return t }
        if ahead == 1 { return "tomorrow \(t)" }
        f.setLocalizedDateFormatFromTemplate(ahead < 7 ? "EEE" : "MMMd")
        return ahead < 7 ? "\(f.string(from: at)) \(t)" : "\(f.string(from: at)), \(t)"
    }
}

public extension RemoteClient {
    /// `projectChatQueueAction`: sends a queued or scheduled message now, drops it, or moves it in the queue.
    func queueAction(chatId: String, _ action: QueueAction, messageId: String) async throws {
        let (name, index): (String, Int?) =
            switch action {
            case .steer: ("steer", nil)
            case .remove: ("remove", nil)
            case .move(let to): ("move", to)
            }
        _ = try await desktop(
            "projectChatQueueAction",
            [.string(chatId), .string(name), .string(messageId), index.map { .number(Double($0)) }])
    }

    /// A queued message's screenshots, which the thread only counts.
    func queuedImages(chatId: String, itemId: String) async throws -> [PastedImage] {
        try await desktop("projectChatQueuedImages", [.string(chatId), .string(itemId)]).decode()
    }
}

/// Removing a queued item is idempotent. After a lost reply, one repeat can
/// confirm removal; if that also fails, the recovered draft must be kept.
@MainActor
public func removeQueuedForEditing(_ remove: () async throws -> Void) async throws -> Bool {
    do {
        try await remove()
        return true
    } catch RemoteCallError.unanswered {
        do {
            try await remove()
            return true
        } catch {
            return false
        }
    }
}
