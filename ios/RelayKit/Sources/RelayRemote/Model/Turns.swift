import Foundation

// What a turn changed (shared/remote.ts RemoteDiff), rolling it back or
// forward, and forking a thread from an answer.

public struct RemoteDiffLine: Codable, Sendable, Equatable {
    /// "add" | "del" | "same"
    public var kind: String
    public var text: String
    public var old: Int?
    public var new: Int?
}

public struct RemoteDiffHunk: Codable, Sendable, Equatable {
    public var header: String
    public var lines: [RemoteDiffLine]
}

public struct RemoteDiff: Codable, Sendable, Equatable {
    public var path: String
    public var binary: Bool
    public var hunks: [RemoteDiffHunk]
    /// Cut to keep the phone responsive; the desktop shows all of it.
    public var truncated: Bool
}

public extension RemoteClient {
    /// One file as a turn changed it, from Relay's snapshots.
    func turnDiff(chatId: String, messageId: String, path: String) async throws -> RemoteDiff {
        let source: JSON = ["kind": "turn", "chatId": .string(chatId), "messageId": .string(messageId), "path": .string(path)]
        return try await call("diff", [source]).decode()
    }

    /// A new thread with the conversation up to this answer; its id.
    func fork(chatId: String, messageId: String) async throws -> String {
        let made: CreatedChat = try await desktop("forkProjectChat", [.string(chatId), .string(messageId)]).decode()
        return made.id
    }

    /// Rolls a turn's files back ("revert") or forward ("redo"), all of them
    /// without `paths`. Answers the files later edits overlap, which stop it
    /// unless `force`.
    func rewindTurn(chatId: String, messageId: String, paths: [String]?, mode: String, force: Bool) async throws
        -> [String]
    {
        let result = try await desktop(
            "rewindProjectTurn",
            [
                .string(chatId), .string(messageId), paths.map { .array($0.map(JSON.string)) } ?? .null, .string(mode),
                .bool(force),
            ])
        return result.object?["conflicts"]?.array?.compactMap(\.string) ?? []
    }
}

/// A turn's files by folder, folders in order; "" is the top level.
public func byFolder(_ files: [TurnFileChange]) -> [(folder: String, files: [TurnFileChange])] {
    Dictionary(grouping: files) { folderOf($0.path) }
        .sorted { $0.key < $1.key }
        .map { ($0.key, $0.value) }
}

public func folderOf(_ path: String) -> String {
    guard let slash = path.lastIndex(of: "/"), slash > path.startIndex else { return "" }
    return String(path[..<slash])
}

public func fileName(_ path: String) -> String {
    path.lastIndex(of: "/").map { String(path[path.index(after: $0)...]) } ?? path
}

/// Why a rollback changed nothing: who was edited after the turn or the rollback.
public func rewindConflictText(_ conflicts: [String], mode: String) -> String {
    let who = conflicts.count == 1 ? "\(fileName(conflicts[0])) was" : "\(conflicts.count) files were"
    return "\(who) edited after \(mode == "revert" ? "this turn" : "the rollback") in ways that overlap it."
}
