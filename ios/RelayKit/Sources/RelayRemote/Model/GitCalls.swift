import Foundation

// The desktop's Git calls a phone makes through `desktop` (shared/projects/api.ts),
// Android's GitApi.kt. `where` is a project id, or a thread's worktree as
// "projectId/chatId" (`workspaceId`).

/// Whose diff of one file: a turn's, the working tree's, a commit's, or a thread's worktree against its branch.
public enum DiffSource: Hashable, Sendable {
    case turn(chatId: String, messageId: String, path: String)
    /// area: "staged" | "unstaged".
    case working(where: String, path: String, area: String)
    case commit(where: String, sha: String, path: String)
    case worktree(chatId: String, path: String)

    public var path: String {
        switch self {
        case .turn(_, _, let p), .working(_, let p, _), .commit(_, _, let p), .worktree(_, let p): p
        }
    }

    var wire: JSON {
        switch self {
        case .turn(let chatId, let messageId, let path):
            ["kind": "turn", "chatId": .string(chatId), "messageId": .string(messageId), "path": .string(path)]
        case .working(let w, let path, let area):
            ["kind": "working", "where": .string(w), "path": .string(path), "area": .string(area)]
        case .commit(let w, let sha, let path):
            ["kind": "commit", "where": .string(w), "sha": .string(sha), "path": .string(path)]
        case .worktree(let chatId, let path):
            ["kind": "worktree", "chatId": .string(chatId), "path": .string(path)]
        }
    }
}

/// A thread's worktree as the bridge names it, or the project's checkout without one.
public func workspaceId(_ projectId: String, chatId: String? = nil) -> String {
    chatId.map { "\(projectId)/\($0)" } ?? projectId
}

public extension RemoteClient {
    func diff(_ source: DiffSource) async throws -> RemoteDiff {
        try await call("diff", [source.wire]).decode()
    }

    func workingTree(_ where: String) async throws -> WorkingTree {
        try await desktop("projectWorkingTree", [.string(`where`)]).decode()
    }

    func gitAction(_ where: String, _ action: GitAction) async throws -> WorkingTree {
        try await desktop("projectGitAction", [.string(`where`), action.wire]).decode()
    }

    /// A message the desktop's model writes for these files.
    func commitMessage(_ where: String, paths: [String]) async throws -> String {
        let text = try await desktop("projectCommitMessage", [.string(`where`), .array(paths.map(JSON.string))])
        return text.string ?? ""
    }

    func branches(_ projectId: String) async throws -> BranchList {
        try await desktop("projectBranches", [.string(projectId)]).decode()
    }

    /// kind: "switch" | "create"; `current` and `head` as the list had them, so a moved checkout refuses.
    func changeBranch(_ projectId: String, kind: String, name: String, current: String, head: String) async throws
        -> BranchList
    {
        let action: JSON = [
            "kind": .string(kind), "name": .string(name), "current": .string(current), "head": .string(head),
        ]
        return try await desktop("projectChangeBranch", [.string(projectId), action]).decode()
    }

    /// scope: "head" | "all".
    func history(_ where: String, scope: String = "head", limit: Int) async throws -> CommitLog {
        try await desktop("projectHistory", [.string(`where`), .string(scope), .number(Double(limit))]).decode()
    }

    func commit(_ where: String, sha: String) async throws -> CommitDetail {
        try await desktop("projectCommit", [.string(`where`), .string(sha)]).decode()
    }

    /// Into `base`, or the default one without.
    func mergePlan(_ where: String, base: String?) async throws -> MergePlan {
        try await desktop("projectMergePlan", [.string(`where`), base.map(JSON.string)]).decode()
    }

    func mergeBranch(_ where: String, _ plan: MergePlan, push: Bool) async throws -> MergeResult {
        let input: JSON = [
            "branch": .string(plan.branch), "head": .string(plan.head), "base": .string(plan.base),
            "baseHead": .string(plan.baseHead), "push": .bool(push),
        ]
        return try await desktop("projectMergeBranch", [.string(`where`), input]).decode()
    }

    func worktreeStatus(_ chatId: String) async throws -> WorktreeStatus {
        try await desktop("projectWorktree", [.string(chatId)]).decode()
    }

    /// Nil when there's no CI to show.
    func ciStatus(_ projectId: String, chatId: String?) async throws -> CiStatus? {
        let answer = try await desktop("projectCiStatus", [.string(projectId), chatId.map(JSON.string)])
        return answer == .null ? nil : try answer.decode()
    }
}
