import Foundation

/// A thread as the phone holds it, every message whole (see `applyChatPatch`).
public struct RemoteChat: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var projectId: String
    public var title: String
    public var messages: [ChatMessage]
    public var requests: [AgentRequest]?
    public var queuePaused: Bool?
    public var scope: ChatScope
    public var stopped: StoppedWorkList?
    public var pending: [ChatPending]?
    public var worktree: ChatWorktree?
    /// From `Bridge.workspaceMoves`.
    public var workspaceMoves: [WorkspaceMove]?
    public var running: Bool?
    public var root: String?
    public var earlier: Int?
    public var cost: ThreadCost?
    public var queue: [RemoteQueued]?
    public var scheduled: [RemoteQueued]?
    /// The last input's, which an old one may hold without a `choice`.
    @Lenient public var settings: ResumeSettings?
    public var lastParentId: String?
    public var hasSend: Bool?
    public var sendPending: Bool?
}

/// `{kind:"project"} | {kind:"pr", ref} | {kind:"review"}`; `ref` stays raw.
public struct ChatScope: Codable, Sendable, Equatable {
    public var kind: String
    public var ref: JSON?
}

public struct StoppedWorkList: Codable, Sendable, Equatable {
    public var at: Int64
    public var items: [ChatPending]
}

public struct ChatWorktree: Codable, Sendable, Equatable {
    public var path: String?
    public var branch: String?
    public var named: String?
    public var wanted: JSON?
    public var from: String?
    public var head: String?
    public var start: String?
    public var base: String?
    public var landed: JSON?
    /// Its pull request on the Git host, once there is one.
    public var pr: PullLink?
}

/// `shared/projects/worktrees.ts` WorkspaceMove: the thread works somewhere else from `after` on.
public struct WorkspaceMove: Codable, Sendable, Equatable {
    public var at: Int64
    /// The main conversation's last message before it; its line shows under that one.
    public var after: String?
    /// "moved" | "recreated" | "switched"
    public var how: String
    /// The folder it works in from here on; nil for the project folder.
    public var to: String?
    public var branch: String?
    public var fresh: Bool?
    public var unasked: Bool?
    public var by: String?
}

public struct AgentRequest: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    /// "approval" | "question" | "page"
    public var kind: String
    public var title: String
    public var detail: String?
    public var note: String?
    /// Strings ("accept", …) or richer decisions; left raw.
    public var decisions: [JSON]?
    public var questions: [AgentQuestion]?
    public var page: HtmlRender?
}

public struct ThreadCost: Codable, Sendable, Equatable {
    public var usd: Double
    public var answers: Int
    public var models: [ModelCost]
}

public struct ModelCost: Codable, Sendable, Equatable {
    public var name: String
    public var usd: Double
}

public struct RemoteQueued: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var body: String
    public var images: Int?
    public var error: String?
    public var parentId: String?
    public var to: String?
    @Lenient public var settings: ResumeSettings?
    /// Only on scheduled ones: when it goes out.
    public var at: Int64?
}

/// A thread list change patched onto the last list (`chatsPatch`).
public struct ChatsPatch: Codable, Sendable, Equatable {
    public var set: [RemoteChatSummary]?
    public var remove: [String]?
}
