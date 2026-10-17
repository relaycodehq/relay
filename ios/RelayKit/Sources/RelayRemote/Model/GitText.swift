import Foundation

// The rules and wording of the Git screens: shared/working-tree.ts, shared/ci.ts,
// mobile/src/remote/split-diff.ts and Android's WorkingTreeText.kt, CiSummary.kt,
// SplitDiff.kt, HistoryScreen.kt and MergeSheet.kt.

/// The most files one commit takes, as on the desktop.
public let maxCommitFiles = 1000
public let maxCommitMessage = 16000

public enum ChangeKind: Sendable { case added, deleted, modified, conflict }

/// Porcelain status letter → how the file name is coloured.
public func changeKind(_ code: String, conflict: Bool = false) -> ChangeKind {
    if conflict { return .conflict }
    if code == "A" || code == "?" { return .added }
    if code == "D" { return .deleted }
    return .modified
}

private let operationNames = [
    "MERGE_HEAD": "merge", "CHERRY_PICK_HEAD": "cherry-pick", "REVERT_HEAD": "revert",
    "rebase-merge": "rebase", "rebase-apply": "rebase",
]

/// The Git operation under way as people say it: `MERGE_HEAD` is a "merge".
public func operationName(_ operation: String) -> String { operationNames[operation] ?? operation }

/// "Merge in progress".
public func operationInProgress(_ operation: String) -> String {
    let name = operationName(operation)
    return name.prefix(1).uppercased() + name.dropFirst() + " in progress"
}

/// What Commit & push takes: every changed file, staged or not, as the desktop's commit sheet picks by default.
public func everyPath(_ tree: WorkingTree) -> [String] { tree.changes.filter { !$0.conflict }.map(\.path) }

/// Why nothing can be committed right now, when something stands in the way.
public func commitBlocker(_ tree: WorkingTree) -> String? {
    if let op = tree.operation { return "Finish the \(operationName(op)) on your computer first." }
    if tree.changes.contains(where: \.conflict) { return "Resolve the conflicts on your computer first." }
    if tree.branch.isEmpty { return "Check out a branch on your computer to commit." }
    return nil
}

/// The line above the commit message: what's in the way, or what Commit & push will do.
public func commitHint(_ tree: WorkingTree) -> String {
    if let stop = commitBlocker(tree) { return stop }
    let all = everyPath(tree).count
    let count = plural(all, "file")
    if all > maxCommitFiles { return "Over \(maxCommitFiles) files. Stage a part and commit that." }
    if let target = tree.pushTarget { return "\(count), then push to \(target)" }
    return "\(count) on \(tree.branch) · no remote to push to"
}

/// Where Push goes: the push target, else the upstream.
public func pushTo(_ tree: WorkingTree) -> String? { tree.pushTarget ?? tree.upstream }

/// The Remote section's line: what's to push and pull, and where.
public func remoteLine(_ tree: WorkingTree) -> String {
    guard let to = pushTo(tree) else { return "This branch has no remote yet." }
    let push = tree.ahead > 0 ? "\(tree.ahead) to push" : "Nothing to push"
    let pull = tree.behind > 0 ? " · \(tree.behind) to pull" : ""
    return "\(push)\(pull) · \(to)"
}

/// Push says exactly where and what before it goes, as on the desktop.
public func pushQuestion(_ tree: WorkingTree) -> (title: String, message: String) {
    let n = tree.outgoing.count
    let title = n > 0 ? "Push \(plural(n, "commit"))?" : "Push the branch?"
    return (title, "To \(pushTo(tree) ?? "origin/\(tree.branch)"). A normal push, never forced.")
}

public func canPush(_ tree: WorkingTree, busy: Bool) -> Bool {
    !busy && !tree.branch.isEmpty && pushTo(tree) != nil && !(tree.upstream != nil && tree.ahead == 0)
}

// MARK: CI

private func ciRank(_ state: String) -> Int {
    switch state {
    case "success": 0
    case "running": 1
    case "failure": 2
    default: -1
    }
}

public struct CiSummary: Sendable, Equatable {
    public var state: String
    /// The run a tap opens.
    public var target: CiRun
}

/// The state the mark wears and the run it opens: a failure outranks a run still
/// going, which outranks a pass; a pass opens the latest run. Nil when no run has a verdict.
public func ciSummary(_ runs: [CiRun]) -> CiSummary? {
    let counted = runs.filter { $0.state != "skipped" }
    guard var worst = counted.first else { return nil }
    for run in counted.dropFirst() where ciRank(run.state) > ciRank(worst.state) { worst = run }
    if worst.state == "success" { worst = counted.max { $0.at < $1.at } ?? worst }
    return CiSummary(state: worst.state, target: worst)
}

public func ciLabel(_ state: String) -> String {
    switch state {
    case "success": "CI passed"
    case "failure": "CI failed"
    case "running": "CI running"
    case "skipped": "CI skipped"
    default: "CI \(state)"
    }
}

// MARK: History

/// "abc1234 · Ada · 5m ago · main, origin/main".
public func historyLine(_ c: CommitSummary, now: Int64) -> String {
    let refs = c.refs.isEmpty ? "" : " · " + c.refs.map(\.name).joined(separator: ", ")
    return "\(c.sha.prefix(7)) · \(c.author) · \(ago(c.time * 1000, now: now))\(refs)"
}

private let statusLabels = ["A": "Added", "M": "Modified", "D": "Deleted", "R": "Renamed", "C": "Copied", "T": "Type changed"]

/// "Modified · +3 −1 · from old/name.ts".
public func commitFileLine(_ f: CommitFileChange) -> String {
    let label = statusLabels[f.status] ?? f.status
    if f.binary { return "\(label) · binary" }
    return "\(label) · +\(f.additions) −\(f.deletions)" + (f.previousPath.map { " · from \($0)" } ?? "")
}

// MARK: Merge

/// What the agent is asked when a merge conflicts.
public func resolveConflictsAsk(_ plan: MergePlan, _ conflicts: [String]) -> String {
    "Merge \(plan.base) into \(plan.branch) and resolve the conflicts in \(conflicts.joined(separator: ", ")). "
        + "Then commit, so the branch can merge into \(plan.base) cleanly."
}

/// A thread's worktree summary line on the Turn screen.
public func worktreeSummary(_ status: WorktreeStatus) -> String {
    if let landed = status.landed {
        return "Landed \(landed.by == "pr" ? "through its pull request" : "in") \(status.from ?? "its branch")."
    }
    return "\(plural(status.files.count, "file")) \(status.from.map { "ahead of \($0)" } ?? "changed")"
}

// MARK: Diff rows

public enum SplitRow: Equatable, Sendable {
    case hunk(String)
    /// A missing side is blank.
    case pair(RemoteDiffLine?, RemoteDiffLine?)
}

/// A diff as side-by-side rows: unchanged lines on both sides, and each run of
/// removed lines set against the added lines that replaced it, one for one, with
/// a blank side where one run is longer.
public func splitRows(_ diff: RemoteDiff) -> [SplitRow] {
    var rows: [SplitRow] = []
    for hunk in diff.hunks {
        rows.append(.hunk(hunk.header))
        var removed: [RemoteDiffLine] = []
        var added: [RemoteDiffLine] = []
        func flush() {
            for i in 0..<max(removed.count, added.count) {
                rows.append(.pair(i < removed.count ? removed[i] : nil, i < added.count ? added[i] : nil))
            }
            removed = []
            added = []
        }
        for line in hunk.lines {
            switch line.kind {
            case "del":
                // A removal after additions starts a new change.
                if !added.isEmpty { flush() }
                removed.append(line)
            case "add": added.append(line)
            default:
                flush()
                rows.append(.pair(line, line))
            }
        }
        flush()
    }
    return rows
}

// MARK: Pull requests

/// Where `/openpr` goes for a branch without a known pull request: the Git host's
/// page for opening one from it, which on GitHub and Gitea also links one already open.
/// Nil for a remote that isn't a web host.
public func newPullRequestUrl(remote: String, branch: String) -> URL? {
    guard !branch.isEmpty, let (host, path) = webRepo(remote) else { return nil }
    let encoded = branch.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? branch
    let base = "https://\(host)/\(path)"
    if host == "dev.azure.com" || host.hasSuffix(".visualstudio.com") {
        let ref = branch.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? branch
        return URL(string: "\(base)/pullrequestcreate?sourceRef=\(ref)")
    }
    if host == "github.com" { return URL(string: "\(base)/pull/new/\(encoded)") }
    return URL(string: "\(base)/compare/\(encoded)")
}

/// A remote's web host and repository path: `https://u@host/o/r.git`,
/// `git@host:o/r.git` and `ssh://git@host/o/r` all give ("host", "o/r").
private func webRepo(_ remote: String) -> (String, String)? {
    var rest = remote.trimmingCharacters(in: .whitespaces)
    var host: String
    if let scheme = rest.range(of: "://") {
        rest = String(rest[scheme.upperBound...])
        if let at = rest.firstIndex(of: "@"), rest[..<at].contains("/") == false { rest = String(rest[rest.index(after: at)...]) }
        guard let slash = rest.firstIndex(of: "/") else { return nil }
        host = String(rest[..<slash])
        rest = String(rest[rest.index(after: slash)...])
    } else if let colon = rest.firstIndex(of: ":") {
        // scp-like: git@host:owner/repo.git
        host = String(rest[..<colon])
        if let at = host.lastIndex(of: "@") { host = String(host[host.index(after: at)...]) }
        rest = String(rest[rest.index(after: colon)...])
    } else {
        return nil
    }
    if let port = host.firstIndex(of: ":") { host = String(host[..<port]) }
    if rest.hasSuffix(".git") { rest.removeLast(4) }
    rest = rest.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    // Azure's SSH remotes: ssh.dev.azure.com:v3/org/project/repo.
    if host == "ssh.dev.azure.com", rest.hasPrefix("v3/") {
        let parts = rest.dropFirst(3).split(separator: "/")
        guard parts.count == 3 else { return nil }
        return ("dev.azure.com", "\(parts[0])/\(parts[1])/_git/\(parts[2])")
    }
    guard !host.isEmpty, rest.contains("/") else { return nil }
    return (host.lowercased(), rest)
}
