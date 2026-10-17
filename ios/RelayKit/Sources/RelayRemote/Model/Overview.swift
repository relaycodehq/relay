import Foundation

// shared/remote.ts's overview and thread list. Enum-like fields stay strings
// so a newer desktop's values still decode.

public struct RemoteOverview: Codable, Sendable, Equatable {
    public var name: String
    /// Missing on desktops from before it was sent.
    public var bridge: Int?
    public var version: String?
    public var appearance: PhoneAppearance?
    /// "missing" | "downloading" | "ready" | "failed" | "unsupported"; nil where dictation isn't offered.
    public var dictation: String?
    public var readAloud: Bool?
    /// Someone at the computer working in Relay; missing from desktops that can't tell.
    public var present: Bool?
    public var drafts: [SharedDraft]?
    public var projects: [RemoteProject]
    /// Unarchived threads with messages, newest first.
    public var chats: [RemoteChatSummary]

    /// Whether the computer tunnels ports to the phone's browser, so its localhost links open there.
    public var tunnels: Bool { (bridge ?? 0) >= Bridge.tunnel }
}

public struct RemoteProject: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var folder: String?
    public var scratch: Bool?
    public var plain: Bool?
    /// "checkout" | "worktree"
    public var workspace: String?
}

/// `{hash, dataUrl}`, or `{hash: null}` for a project without one.
public struct RemoteProjectIcon: Codable, Sendable, Equatable {
    public var hash: String?
    public var dataUrl: String?
}

public struct RemoteChatSummary: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var projectId: String
    public var title: String
    /// "project" | "pr" | "review"
    public var scope: String
    public var updated: Int64
    public var created: Int64
    public var provider: String?
    public var running: Bool?
    public var runningSince: Int64?
    public var waiting: Bool?
    public var asking: Bool?
    public var blocked: Bool?
    public var settledAt: Int64?
    public var settleWhenDone: Int64?
    public var autoSettled: Bool?
    public var markedUnread: Bool?
    public var snoozedAt: Int64?
    public var snoozedUntil: Int64?
    public var seenAt: Int64?
    public var branch: String?
    public var worktree: Bool?
    public var pending: [ChatPending]?
    public var nextSend: Int64?
    public var queueMark: String?
    public var empty: Bool?
    public var goal: ThreadGoal?
    public var startedBy: StartedBy?
    public var limitResume: LimitResume?
    /// Moves whenever the thread's notes do; fetch them again then. From `Bridge.notes`.
    public var notesMark: String?
}

/// `{kind:"task", id, description, since, agent?} | {kind:"wakeup", id, prompt, recurring, at?}`, flattened.
public struct ChatPending: Codable, Sendable, Equatable {
    public var kind: String
    public var id: String
    public var description: String?
    public var since: Int64?
    public var agent: Bool?
    public var prompt: String?
    public var recurring: Bool?
    public var at: Int64?
    /// On stopped work only: the side conversation whose session ran it.
    public var parentId: String?
}

public struct ThreadGoal: Codable, Sendable, Equatable {
    public var provider: String
    public var objective: String
    /// "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete" | "failed"
    public var status: String
    public var tokensUsed: Int64?
    public var tokenBudget: Int64?
    public var timeUsedSeconds: Double?
    public var checks: Int?
    public var lastCheck: String?
    public var gaveUp: Bool?
    public var updated: Int64
}

public struct StartedBy: Codable, Sendable, Equatable {
    public var chatId: String
    public var agent: String
    public var sendsApproved: Bool?
}

public struct LimitResume: Codable, Sendable, Equatable {
    public var messageId: String
    public var provider: String
    public var at: Int64
    public var off: Bool?
}

public struct PhonePalette: Codable, Sendable, Equatable {
    /// "light" | "dark"
    public var kind: String
    public var sidebar: String
    public var surface: String
    public var toolbar: String
    public var inbox: String
    public var text: String
    public var muted: String
    public var border: String
    public var hover: String
    public var selected: String
    public var accent: String
    public var accentSoft: String
    public var onAccent: String
    /// The Send button's colour; older desktops leave it out.
    public var send: String?
    public var onSend: String?
    public var diffAddition: String
    public var diffDeletion: String
}

public struct PhoneAppearance: Codable, Sendable, Equatable {
    /// "system" | "light" | "dark"
    public var mode: String
    public var light: PhonePalette
    public var dark: PhonePalette
}

public struct ComputerInfo: Codable, Sendable, Equatable {
    public var version: String
    public var bridge: Int
    /// shared/updates' UpdateState, left raw.
    public var update: JSON?
}

/// a > b for x.y.z and x.y.z.n versions (shared/phone-app's `newerVersion`). Non-numbers never count as newer.
public func newerVersion(_ a: String, _ b: String) -> Bool {
    let x = a.split(separator: ".", omittingEmptySubsequences: false).map { Double($0) ?? .nan }
    let y = b.split(separator: ".", omittingEmptySubsequences: false).map { Double($0) ?? .nan }
    for i in 0..<4 {
        let p = i < x.count ? x[i] : 0
        let q = i < y.count ? y[i] : 0
        if p != q { return p > q }
    }
    return false
}
