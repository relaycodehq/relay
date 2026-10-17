import Foundation

/// A frame from the desktop. One flat shape: which fields are set depends on `t`.
struct ServerFrame {
    /// "paired" | "ready" | "denied" | "result" | "event" | "tick"
    var t: String
    var deviceId: String?
    var token: String?
    var name: String?
    var bridge: Int?
    var hosts: [String]?
    var reason: String?
    var id: Int?
    var ok: Bool?
    var value: JSON?
    var error: String?
    /// Kept raw: messagePatch needs the JSON tree, and events have to be told apart first.
    var event: [String: JSON]?
    var s: Int?

    init(_ json: JSON) throws {
        guard let t = json["t"]?.string else { throw ChannelError(description: "A frame without a type.") }
        self.t = t
        deviceId = json["deviceId"]?.string
        token = json["token"]?.string
        name = json["name"]?.string
        bridge = json["bridge"]?.int
        hosts = json["hosts"]?.array?.compactMap(\.string)
        reason = json["reason"]?.string
        id = json["id"]?.int
        ok = json["ok"]?.bool
        value = json["value"]
        error = json["error"]?.string
        event = json["event"]?.object
        s = json["s"]?.int
    }
}

/// What `rebuild` keeps per connection: answers still streaming, as JSON, and
/// the last thread list. Both ends start over each connection.
struct ConnectionEvents {
    private var streaming: [String: [String: JSON]] = [:]
    private var chats: [RemoteChatSummary]?

    mutating func reset() {
        streaming = [:]
        chats = nil
    }

    /// The event with patches applied. Nil for a patch with nothing to apply to
    /// (the final answer comes whole) or an unknown kind.
    mutating func rebuild(_ event: [String: JSON]) throws -> RemoteEvent? {
        switch event["kind"]?.string {
        case "message", "messagePatch":
            let message: [String: JSON]
            if event["kind"]?.string == "messagePatch" {
                guard let patch = event["patch"]?.object, let id = patch["id"]?.string,
                    let prev = streaming[id]
                else { return nil }
                message = applyMessagePatch(prev, patch)
            } else {
                guard let whole = event["message"]?.object else { return nil }
                message = whole
            }
            let decoded = try JSON.object(message).decode(ChatMessage.self)
            if decoded.streaming {
                streaming[decoded.id] = message
            } else {
                streaming.removeValue(forKey: decoded.id)
            }
            guard let chatId = event["chatId"]?.string else { return nil }
            return .message(chatId: chatId, message: decoded, title: event["title"]?.string)
        case "chats":
            let list = try (event["chats"] ?? .array([])).decode([RemoteChatSummary].self)
            chats = list
            return .chats(list)
        case "chatsPatch":
            guard let was = chats, let patch = event["patch"] else { return nil }
            let list = applyChatsPatch(was, try patch.decode(ChatsPatch.self))
            chats = list
            return .chats(list)
        case "appearance":
            guard let appearance = event["appearance"] else { return nil }
            return .appearance(try appearance.decode(PhoneAppearance.self))
        case "presence":
            return .presence(event["present"]?.bool == true)
        case "draft":
            guard let change = event["change"] else { return nil }
            return .draft(try change.decode(DraftChange.self))
        case "handoff":
            return .handoff(.object(event))
        default:
            return nil
        }
    }
}
