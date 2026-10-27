import Foundation

// What the desktop's Git calls answer (shared/working-tree.ts, branches.ts,
// branch-merge.ts, history.ts, ci.ts, projects/worktrees.ts), as Android's
// remote/model/Git.kt has them. Enum-like fields stay strings so newer values decode.

public struct WorkingChange: Codable, Sendable, Equatable, Hashable {
    public var path: String
    public var previousPath: String?
    /// Porcelain status letters: " ", "M", "A", "D", "R", "?" …
    public var index: String
    public var worktree: String
    public var conflict: Bool

    public init(path: String, previousPath: String? = nil, index: String, worktree: String, conflict: Bool = false) {
        self.path = path
        self.previousPath = previousPath
        self.index = index
        self.worktree = worktree
        self.conflict = conflict
    }

    /// Has a diff between HEAD and the index; untracked files don't.
    public var staged: Bool { index != " " && index != "?" }
    /// Has a diff between the index and the file on disk, or is in conflict.
    public var unstaged: Bool { worktree != " " || conflict }
}

public struct LineCounts: Codable, Sendable, Equatable {
    public var additions: Int
    public var deletions: Int
}

public struct GitCommit: Codable, Sendable, Equatable, Hashable {
    public var sha: String
    public var subject: String
}

public struct WorkingTree: Codable, Sendable, Equatable {
    public var head: String
    public var branch: String
    public var revision: String
    public var changes: [WorkingChange]
    public var upstream: String?
    public var ahead: Int
    public var behind: Int
    public var pushTarget: String?
    /// The remote's address, credentials taken out.
    public var pushUrl: String?
    public var operation: String?
    public var lines: LineCounts?
    public var outgoing: [GitCommit]

    public init(
        head: String = "", branch: String, revision: String, changes: [WorkingChange] = [], upstream: String? = nil,
        ahead: Int = 0, behind: Int = 0, pushTarget: String? = nil, pushUrl: String? = nil, operation: String? = nil,
        outgoing: [GitCommit] = []
    ) {
        self.head = head
        self.branch = branch
        self.revision = revision
        self.changes = changes
        self.upstream = upstream
        self.ahead = ahead
        self.behind = behind
        self.pushTarget = pushTarget
        self.pushUrl = pushUrl
        self.operation = operation
        self.outgoing = outgoing
    }
}

/// `gitActionSchema`, strict on the desktop: unset fields are left out.
public enum GitAction: Sendable, Equatable {
    case stage(revision: String, paths: [String])
    case unstage(revision: String, paths: [String])
    /// Just these files as they are on disk, or without paths what's staged.
    case commit(revision: String, message: String, paths: [String]?)
    case push(revision: String)
    case pull(revision: String)
    case fetch

    var wire: JSON {
        func paths(_ p: [String]) -> JSON { .array(p.map(JSON.string)) }
        switch self {
        case .stage(let r, let p): return ["kind": "stage", "revision": .string(r), "paths": paths(p)]
        case .unstage(let r, let p): return ["kind": "unstage", "revision": .string(r), "paths": paths(p)]
        case .commit(let r, let message, let p):
            var o: [String: JSON] = ["kind": "commit", "revision": .string(r), "message": .string(message)]
            if let p { o["paths"] = paths(p) }
            return .object(o)
        case .push(let r): return ["kind": "push", "revision": .string(r)]
        case .pull(let r): return ["kind": "pull", "revision": .string(r)]
        case .fetch: return ["kind": "fetch"]
        }
    }
}

public struct BranchRef: Codable, Sendable, Equatable, Hashable {
    public var name: String
    public var ref: String
    public var current: Bool
    public var remote: Bool
    public var worktree: Bool
    public var unrelated: Bool?
    /// For a remote branch: the local one checking it out would make; older desktops leave it out.
    public var local: String?
}

public struct BranchList: Codable, Sendable, Equatable {
    public var current: String
    public var head: String
    public var branches: [BranchRef]
    public var bases: [String]
}

/// "head" | "branch" | "remote" | "tag".
public struct CommitRef: Codable, Sendable, Equatable, Hashable {
    public var name: String
    public var kind: String
}

public struct CommitSummary: Codable, Sendable, Equatable, Hashable {
    public var sha: String
    public var parents: [String]
    public var author: String
    /// Unix seconds.
    public var time: Int64
    public var refs: [CommitRef]
    public var subject: String
}

public struct CommitLog: Codable, Sendable, Equatable {
    public var commits: [CommitSummary]
    public var more: Bool
}

public struct CommitFileChange: Codable, Sendable, Equatable, Hashable {
    public var path: String
    public var previousPath: String?
    /// "A" | "M" | "D" | "R" | "C" | "T"
    public var status: String
    public var additions: Int
    public var deletions: Int
    public var binary: Bool
}

public struct CommitDetail: Codable, Sendable, Equatable {
    public var sha: String
    public var parents: [String]
    public var author: String
    public var email: String
    public var time: Int64
    public var refs: [CommitRef]
    public var subject: String
    public var body: String
    /// Against the first parent.
    public var files: [CommitFileChange]
}

public struct MergePlan: Codable, Sendable, Equatable {
    public var branch: String
    public var head: String
    public var base: String
    public var baseHead: String
    /// Local branches it can merge into, the default first.
    public var bases: [String]
    /// Newest first, at most 50.
    public var commits: [GitCommit]
    public var fastForward: Bool
    public var pushTarget: String?
    public var checkedOutAt: String?
    public var snapshots: Int
    public var uncommitted: Int
}

/// Merged, or `merged == false` with the files that conflict.
public struct MergeResult: Codable, Sendable, Equatable {
    public var merged: Bool
    public var base: String?
    public var sha: String?
    public var fastForward: Bool?
    public var pushedTo: String?
    public var conflicts: [String]?
}

public struct WorktreeStatus: Codable, Sendable, Equatable {
    public var branch: String?
    public var path: String?
    /// The branch it merges into.
    public var from: String?
    /// What it has that `from` doesn't yet, committed or not.
    public var files: [TurnFileChange]
    /// by: "merge" | "pr".
    public var landed: Landed?
    public var pr: PullLink?
    public var removed: Bool

    public struct Landed: Codable, Sendable, Equatable {
        public var by: String
    }
}

/// A worktree's pull request on the Git host.
public struct PullLink: Codable, Sendable, Equatable, Hashable {
    public var number: Int
    public var url: String
}

/// state: "success" | "failure" | "running" | "skipped".
public struct CiRun: Codable, Sendable, Equatable, Hashable {
    public var workflow: String
    public var state: String
    public var failedJob: String?
    public var url: String
    /// When it finished, or started while it's still going (ms).
    public var at: Int64

    public init(workflow: String, state: String, failedJob: String? = nil, url: String, at: Int64) {
        self.workflow = workflow
        self.state = state
        self.failedJob = failedJob
        self.url = url
        self.at = at
    }
}

public struct CiCommit: Codable, Sendable, Equatable {
    public var sha: String
    public var message: String?
    public var author: String?
}

public struct CiStatus: Codable, Sendable, Equatable {
    /// The CI host as users know it, e.g. "GitHub".
    public var source: String
    /// The thread's branch, or the default one when that has none.
    public var branch: String
    public var commit: CiCommit
    public var runs: [CiRun]
    /// Commits here that CI hasn't run on yet.
    public var ahead: Int
}
