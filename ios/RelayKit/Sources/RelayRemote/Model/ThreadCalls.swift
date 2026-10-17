import Foundation

// The thread screen's own calls besides sending and the queue (Android's
// ThreadActions.kt): resuming a stopped answer, the strips' actions and the
// worktree setup's rerun.

public extension RemoteClient {
    /// Picks a stopped or failed answer back up, on `settings` when the composer changed them.
    func resume(chatId: String, settings: ResumeSettings?) async throws {
        _ = try await desktop("resumeProjectChat", [.string(chatId), try settings.map { try JSON(encoding: $0) }])
    }

    /// Stops a background task, or cancels a wake-up, the thread's agent left behind.
    func stopPending(chatId: String, itemId: String) async throws {
        _ = try await desktop("stopProjectChatPending", [.string(chatId), .string(itemId)])
    }

    /// "resume" | "dismiss" the work that stopped when Relay closed.
    func resolveStoppedWork(chatId: String, _ action: String) async throws {
        _ = try await desktop("resolveStoppedWork", [.string(chatId), .string(action)])
    }

    /// Whether the answer a usage limit stopped carries on once it lifts.
    func setLimitResume(chatId: String, _ on: Bool) async throws {
        _ = try await desktop("setLimitResume", [.string(chatId), .bool(on)])
    }

    func rerunWorktreeSetup(chatId: String, messageId: String) async throws {
        _ = try await desktop("rerunWorktreeSetup", [.string(chatId), .string(messageId)])
    }
}

/// Setup that didn't get through can run again.
public func setupCanRerun(_ m: ChatMessage) -> Bool {
    m.worktreeCommand?.kind == "setup" && (m.status == "failed" || m.status == "cancelled")
}

public func latestSetup(_ messages: [ChatMessage]) -> ChatMessage? {
    messages.last { $0.worktreeCommand?.kind == "setup" }
}

/// What a plan's go-ahead sends, and what the composer goes on with: on the
/// planner, out of Plan mode. `settings` already on the planner keep their model.
public func planGoAhead(_ settings: ResumeSettings, planner: String) -> (send: ProjectChatSend, next: ResumeSettings) {
    var next = settings.onAgent(planner)
    next.interactionMode = "default"
    return (ProjectChatSend(body: implementPlan(planner), settings: next), next)
}

/// A stopped or failed answer the thread can pick back up: nothing runs, it was
/// the last answer in this conversation, and the thread last sent here.
public func canResume(_ thread: RemoteChat, conversation: [ChatMessage], rootId: String?, running: Bool) -> Bool {
    guard !running, let last = conversation.last(where: isAnswer), ["cancelled", "failed"].contains(last.status) else {
        return false
    }
    return thread.settings != nil && thread.lastParentId == rootId
}
