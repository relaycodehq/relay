import Foundation

// The desktop's file, task and working-tree calls a phone makes through `desktop`
// (shared/projects/api.ts). `where` is a project id, or `projectId/chatId` for a thread's worktree.

/// A file as it is on disk (shared/types.ts LocalFile).
public struct LocalFile: Codable, Sendable, Equatable {
    public var path: String
    public var branch: String
    public var head: String
    public var contents: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decode(String.self, forKey: .path)
        branch = try c.decodeIfPresent(String.self, forKey: .branch) ?? ""
        head = try c.decodeIfPresent(String.self, forKey: .head) ?? ""
        contents = try c.decode(String.self, forKey: .contents)
    }
}

/// A dev server or process the project's agents left running.
public struct ProjectTask: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var command: String
    public var kind: String?
    public var title: String
    public var agent: String?
    /// "relay" | "terminal" | "external" | "detached"
    public var origin: String
    public var chatId: String?
    public var worktree: String?
    public var folder: String?
    public var started: Int64
    public var ports: [Int]
    public var pids: Int?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        command = try c.decode(String.self, forKey: .command)
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        agent = try c.decodeIfPresent(String.self, forKey: .agent)
        origin = try c.decode(String.self, forKey: .origin)
        chatId = try c.decodeIfPresent(String.self, forKey: .chatId)
        worktree = try c.decodeIfPresent(String.self, forKey: .worktree)
        folder = try c.decodeIfPresent(String.self, forKey: .folder)
        started = try c.decode(Int64.self, forKey: .started)
        ports = try c.decodeIfPresent([Int].self, forKey: .ports) ?? []
        pids = try c.decodeIfPresent(Int.self, forKey: .pids)
    }
}

/// What a project's screen says of its working tree (shared/git WorkingTree, the few fields it reads).
public struct WorkingTreeGlance: Decodable, Sendable, Equatable {
    public var branch: String
    public var changed: Int
    public var additions: Int
    public var deletions: Int
    public var ahead: Int
    public var behind: Int
    /// `MERGE_HEAD`, `rebase-merge`… while one is under way.
    public var operation: String?

    public init(
        branch: String = "", changed: Int = 0, additions: Int = 0, deletions: Int = 0, ahead: Int = 0, behind: Int = 0,
        operation: String? = nil
    ) {
        self.branch = branch
        self.changed = changed
        self.additions = additions
        self.deletions = deletions
        self.ahead = ahead
        self.behind = behind
        self.operation = operation
    }

    private enum Keys: String, CodingKey { case branch, changes, lines, ahead, behind, operation }
    private struct Lines: Decodable {
        var additions: Int?
        var deletions: Int?
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        branch = try c.decodeIfPresent(String.self, forKey: .branch) ?? ""
        changed = try c.decodeIfPresent([JSON].self, forKey: .changes)?.count ?? 0
        let lines = try c.decodeIfPresent(Lines.self, forKey: .lines)
        additions = lines?.additions ?? 0
        deletions = lines?.deletions ?? 0
        ahead = try c.decodeIfPresent(Int.self, forKey: .ahead) ?? 0
        behind = try c.decodeIfPresent(Int.self, forKey: .behind) ?? 0
        operation = try c.decodeIfPresent(String.self, forKey: .operation)
    }
}

public extension RemoteClient {
    /// Every file in the project or worktree, as paths from its root.
    func projectFiles(where place: String) async throws -> [String] {
        try await desktop("projectFiles", [.string(place)]).decode()
    }

    func projectFile(where place: String, path: String) async throws -> LocalFile {
        try await desktop("projectFile", [.string(place), .string(path)]).decode()
    }

    func projectTasks(projectId: String) async throws -> [ProjectTask] {
        try await desktop("projectTasks", [.string(projectId)]).decode()
    }

    func restartProjectTask(projectId: String, taskId: String) async throws {
        _ = try await desktop("restartProjectTask", [.string(projectId), .string(taskId)])
    }

    func stopProjectTask(projectId: String, taskId: String) async throws {
        _ = try await desktop("stopProjectTask", [.string(projectId), .string(taskId)])
    }

    /// `projectWorkingTree`, read for the project screen's glance.
    func workingTreeGlance(where place: String) async throws -> WorkingTreeGlance {
        try await desktop("projectWorkingTree", [.string(place)]).decode()
    }
}
