import Foundation

/// shared/watch.ts's WatchNote: what the side check flagged in a turn. The message model keeps
/// notes untyped, so they're read here.
public struct WatchNote: Decodable, Sendable, Equatable, Identifiable {
    public var id: String
    public var tag: String
    public var line: String
    public var title: String
    public var points: [String]
    public var diff: WatchDiff?
    public var steer: String?
    public var agent: WatchAgent?
    public var closed: Bool?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        tag = try c.decode(String.self, forKey: .tag)
        line = try c.decode(String.self, forKey: .line)
        title = try c.decode(String.self, forKey: .title)
        points = try c.decodeIfPresent([String].self, forKey: .points) ?? []
        diff = try c.decodeIfPresent(WatchDiff.self, forKey: .diff)
        steer = try c.decodeIfPresent(String.self, forKey: .steer)
        agent = try c.decodeIfPresent(WatchAgent.self, forKey: .agent)
        closed = try c.decodeIfPresent(Bool.self, forKey: .closed)
    }

    private enum CodingKeys: String, CodingKey { case id, tag, line, title, points, diff, steer, agent, closed }
}

public struct WatchDiff: Decodable, Sendable, Equatable {
    public var file: String
    public var lines: [String]
}

public struct WatchAgent: Decodable, Sendable, Equatable {
    public var id: String
    public var label: String
}

/// The notes that read as watch notes; any other shape is skipped.
public func watchNotes(_ notes: [JSON]?) -> [WatchNote] {
    (notes ?? []).compactMap { try? $0.decode(WatchNote.self) }
}

public extension RemoteClient {
    /// Takes a watch note out of its turn. `how`: "dismissed" | "told" | "known"; `read` says its
    /// details were open. From `Bridge.away`.
    func closeWatchNote(chatId: String, messageId: String, noteId: String, how: String, read: Bool) async throws {
        _ = try await desktop(
            "closeWatchNote", [.string(chatId), .string(messageId), .string(noteId), .string(how), .bool(read)])
    }
}
