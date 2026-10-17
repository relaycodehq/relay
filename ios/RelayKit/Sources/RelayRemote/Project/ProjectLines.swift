import Foundation

// What the project, files and tasks screens say, from what the desktop sends
// (Android's FileEntries.kt, ProjectScreen.kt and TasksScreen.kt).

/// Search results stop here; the phone isn't where to scroll a whole monorepo.
public let maxFileSearchResults = 300

public struct FileEntry: Equatable, Sendable, Identifiable {
    public var path: String
    public var folder: Bool

    public init(_ path: String, folder: Bool) {
        self.path = path
        self.folder = folder
    }

    public var id: String { path }
    public var name: String { path.split(separator: "/").last.map(String.init) ?? path }
}

/// With a `query`, every path containing it, any case, capped; otherwise the folders
/// directly under `dir` and then its own files, each sorted.
public func fileEntries(_ files: [String], dir: String, query: String) -> [FileEntry] {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    if !q.isEmpty {
        return files.lazy.filter { $0.lowercased().contains(q) }.prefix(maxFileSearchResults)
            .map { FileEntry($0, folder: false) }
    }
    let prefix = dir.isEmpty ? "" : "\(dir)/"
    var folders = Set<String>()
    var here: [String] = []
    for f in files where f.hasPrefix(prefix) {
        let rest = f.dropFirst(prefix.count)
        if let slash = rest.firstIndex(of: "/") {
            folders.insert(prefix + rest[..<slash])
        } else {
            here.append(f)
        }
    }
    return folders.sorted().map { FileEntry($0, folder: true) } + here.sorted().map { FileEntry($0, folder: false) }
}

/// "3 changed · +40 −2 · 1 to push".
public func changesLine(_ tree: WorkingTreeGlance) -> String {
    [
        tree.changed > 0 ? "\(tree.changed) changed" : "No changes",
        tree.additions > 0 || tree.deletions > 0 ? "+\(tree.additions) −\(tree.deletions)" : nil,
        tree.ahead > 0 ? "\(tree.ahead) to push" : nil,
        tree.behind > 0 ? "\(tree.behind) to pull" : nil,
    ].compactMap { $0 }.joined(separator: " · ")
}

private let origins = [
    "relay": "Started by an agent in Relay",
    "terminal": "A Relay terminal",
    "external": "A Claude or Codex CLI outside Relay",
    "detached": "Running on its own",
]

/// "Started by an agent in Relay · in a worktree · port 5173 · started 5m ago".
public func taskMeta(_ task: ProjectTask, now: Int64) -> String {
    [
        origins[task.origin] ?? task.origin,
        task.worktree != nil ? "in a worktree" : nil,
        task.ports.isEmpty ? nil : "port \(task.ports.map(String.init).joined(separator: ", "))",
        "started \(ago(task.started, now: now))",
    ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
}

public extension RemoteChat {
    /// What the bridge's file calls take for this thread: its worktree, else its project.
    var bridgeWhere: String { worktree?.path != nil ? "\(projectId)/\(id)" : projectId }
}
