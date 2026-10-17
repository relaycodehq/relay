import Foundation

// shared/remote-delta.ts: how the desktop's patches rebuild what it sent whole before.

/// `applyList`: cut to `length`, then overwrite by index (holes become null, as in JS).
func applyListPatch(_ was: [JSON]?, _ patch: [String: JSON]) -> [JSON] {
    let length = max(0, patch["length"]?.int ?? 0)
    var list = Array((was ?? []).prefix(length))
    for entry in patch["items"]?.array ?? [] {
        guard let pair = entry.array, pair.count == 2, let i = pair[0].int, i >= 0 else { continue }
        while list.count <= i { list.append(.null) }
        list[i] = pair[1]
    }
    return list
}

/// `applyMessagePatch`, on the JSON tree so fields this app doesn't model
/// survive. `body.from` counts UTF-16 units, as JS strings do.
public func applyMessagePatch(_ prev: [String: JSON], _ patch: [String: JSON]) -> [String: JSON] {
    var next = prev
    for (key, value) in patch["set"]?.object ?? [:] { next[key] = value }
    for key in patch["unset"]?.array ?? [] {
        if let key = key.string { next.removeValue(forKey: key) }
    }
    if let body = patch["body"]?.object {
        let was = Array((prev["body"]?.string ?? "").utf16)
        let from = min(max(0, body["from"]?.int ?? 0), was.count)
        next["body"] = .string(String(decoding: was[..<from], as: UTF16.self) + (body["text"]?.string ?? ""))
    }
    for key in ["trace", "activity"] {
        guard let list = patch[key]?.object else { continue }
        next[key] = .array(applyListPatch(prev[key]?.array, list))
    }
    return next
}

/// Newest first, then by id: the order both ends keep a thread list in.
public func chatOrder(_ a: RemoteChatSummary, _ b: RemoteChatSummary) -> Bool {
    a.updated != b.updated ? a.updated > b.updated : a.id < b.id
}

public func applyChatsPatch(_ prev: [RemoteChatSummary], _ patch: ChatsPatch) -> [RemoteChatSummary] {
    var chats = [String: RemoteChatSummary]()
    for c in prev { chats[c.id] = c }
    for id in patch.remove ?? [] { chats.removeValue(forKey: id) }
    for c in patch.set ?? [] { chats[c.id] = c }
    return chats.values.sorted(by: chatOrder)
}

public struct MissingMessage: Error, CustomStringConvertible {
    public var description: String { "Conversation update is missing a message." }
}

/// Message id → version the phone holds, sent as `known` so unchanged messages come back as ids.
public func knownOf(_ chat: RemoteChat?) -> [String: Int64]? {
    chat.map { Dictionary($0.messages.map { ($0.id, $0.version) }, uniquingKeysWith: { _, last in last }) }
}

/// A `chat` answer with messages the phone already held sent as their ids; throws `MissingMessage`.
public func applyChatPatch(_ patch: [String: JSON], previous: RemoteChat?) throws -> RemoteChat {
    let held = Dictionary((previous?.messages ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    let messages = try (patch["messages"]?.array ?? []).map { m -> ChatMessage in
        if let id = m.string {
            guard let message = held[id] else { throw MissingMessage() }
            return message
        }
        return try m.decode(ChatMessage.self)
    }
    var rest = patch
    rest["messages"] = .array([])
    var chat = try JSON.object(rest).decode(RemoteChat.self)
    chat.messages = messages
    return chat
}
