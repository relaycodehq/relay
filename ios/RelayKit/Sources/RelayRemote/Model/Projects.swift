import Foundation

// The Projects tab's lists (Android's ProjectsList.kt) and the project icons' index
// (IconIndex.kt).

/// Every Scratchpad chat has a folder of its own; together they're one list, newest first.
public func scratchChats(_ overview: RemoteOverview) -> [RemoteChatSummary] {
    let ids = Set(overview.projects.filter { $0.scratch == true }.map(\.id))
    return overview.chats.filter { ids.contains($0.projectId) }.sorted { $0.updated > $1.updated }
}

/// The desktop's sidebar: projects under their virtual folders, "Projects" first.
public func projectFolders(_ projects: [RemoteProject]) -> [(title: String, projects: [RemoteProject])] {
    var order: [String] = []
    var groups: [String: [RemoteProject]] = [:]
    for p in projects where p.scratch != true {
        let title = p.folder.flatMap { $0.isEmpty ? nil : $0 } ?? "Projects"
        if groups[title] == nil { order.append(title) }
        groups[title, default: []].append(p)
    }
    return order
        .sorted { a, b in a == "Projects" ? b != "Projects" : b == "Projects" ? false : a < b }
        .map { ($0, groups[$0]!) }
}

/// "2 working · 5 threads · 3h ago", or "No threads yet".
public func projectLine(_ chats: [RemoteChatSummary], now: Int64) -> String {
    guard let latest = chats.map(\.updated).max() else { return "No threads yet" }
    let busy = chats.count { $0.running == true || $0.waiting == true }
    let count = "\(chats.count) \(chats.count == 1 ? "thread" : "threads")"
    return (busy > 0 ? "\(busy) working · " : "") + "\(count) · \(ago(latest, now: now))"
}

/// A row's "just now", "4m ago", "yesterday", then a date.
public func ago(_ at: Int64, now: Int64) -> String {
    let minutes = Int64((Double(now - at) / 60_000).rounded())
    if minutes < 1 { return "just now" }
    if minutes < 60 { return "\(minutes)m ago" }
    let hours = Int64((Double(minutes) / 60).rounded())
    if hours < 24 { return "\(hours)h ago" }
    let days = Int64((Double(hours) / 24).rounded())
    if days == 1 { return "yesterday" }
    if days < 7 { return "\(days)d ago" }
    return Date(timeIntervalSince1970: Double(at) / 1000).formatted(.dateTime.month(.abbreviated).day())
}

/// One connection's projects that threads point at but the overview doesn't list yet
/// (Android's MissingProjects.kt): new ids batch into one refetch, and ids the desktop really
/// removed are never asked about twice.
public struct MissingProjects: Sendable {
    private var asked: Set<String> = []
    private var pending: Set<String> = []

    public init() {}

    /// Whether these threads point at projects not asked about yet.
    public mutating func observe(projects: [RemoteProject], chats: [RemoteChatSummary]) -> Bool {
        let known = Set(projects.map(\.id))
        var added = false
        for chat in chats where !known.contains(chat.projectId) && !asked.contains(chat.projectId) {
            if pending.insert(chat.projectId).inserted { added = true }
        }
        return added
    }

    /// The ids the refetch now going out checks.
    public mutating func take() -> Set<String> {
        let ids = pending
        pending = []
        asked.formUnion(ids)
        return ids
    }

    /// A refetch that failed checked nothing: its ids are asked again on the next push.
    public mutating func failed(_ ids: Set<String>) { asked.subtract(ids) }
}

// The phone's index of project icons, kept apart per computer: each sync answers for one
// computer's projects, so it may only replace or drop that computer's icons.

public struct IconEntry: Codable, Sendable, Equatable {
    public var hash: String?
    /// The saved file, relative to the icons' folder.
    public var path: String?

    public init(hash: String? = nil, path: String? = nil) {
        self.hash = hash
        self.path = path
    }
}

/// Icons by computer, then by project id.
public typealias IconIndex = [String: [String: IconEntry]]

/// The hashes the phone holds for these projects of `computer`, to ask only for the rest.
public func knownHashes(_ index: IconIndex, computer: String, projectIds: [String]) -> [String: String?] {
    let mine = index[computer] ?? [:]
    var known: [String: String?] = [:]
    for id in projectIds { if let entry = mine[id] { known[id] = entry.hash } }
    return known
}

public struct IconUpdate: Sendable, Equatable {
    public var index: IconIndex
    /// Files nothing points at any more.
    public var unused: [String]
}

/// The index once `computer` answered with `updates` for `projectIds`: changed icons replaced,
/// its removed projects' icons gone, other computers' untouched.
public func applyIconUpdates(
    _ index: IconIndex, computer: String, projectIds: [String], updates: [String: RemoteProjectIcon],
    save: (_ id: String, _ hash: String, _ dataUrl: String) -> String?
) -> IconUpdate {
    var mine = index[computer] ?? [:]
    var unused: [String] = []
    for (id, icon) in updates {
        let old = mine[id]?.path
        let entry = icon.hash.map { hash in IconEntry(hash: hash, path: icon.dataUrl.flatMap { save(id, hash, $0) }) }
            ?? IconEntry()
        mine[id] = entry
        if let old, old != entry.path { unused.append(old) }
    }
    let keep = Set(projectIds)
    for (id, entry) in mine where !keep.contains(id) {
        if let path = entry.path { unused.append(path) }
        mine[id] = nil
    }
    var next = index
    next[computer] = mine
    return IconUpdate(index: next, unused: unused)
}

/// Lookup stays scoped too: copied desktop state can share project ids.
public func projectIconPath(_ index: IconIndex, computer: String?, projectId: String) -> String? {
    computer.flatMap { index[$0]?[projectId]?.path }
}

private let iconExtensions = [
    "image/svg+xml": "svg", "image/png": "png", "image/webp": "webp", "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
]

/// A data URL's file extension and base64 body, or nil for a type the phone doesn't keep.
public func iconData(_ dataUrl: String) -> (ext: String, base64: String)? {
    guard dataUrl.hasPrefix("data:"), let comma = dataUrl.firstIndex(of: ",") else { return nil }
    let head = dataUrl[dataUrl.index(dataUrl.startIndex, offsetBy: 5)..<comma]
    guard head.hasSuffix(";base64"), let ext = iconExtensions[String(head.dropLast(7))] else { return nil }
    let body = String(dataUrl[dataUrl.index(after: comma)...])
    return body.isEmpty ? nil : (ext, body)
}

extension RemoteClient {
    /// An unused Scratchpad folder, or a fresh one: where a new Scratchpad chat starts. The
    /// desktop answers with the project; an id alone is taken as well.
    public func createScratch() async throws -> String {
        let made = try await desktop("createScratch")
        guard let id = made.string ?? made.object?["id"]?.string else {
            throw RemoteCallError.rejected("Relay didn't make a Scratchpad folder.")
        }
        return id
    }
}
