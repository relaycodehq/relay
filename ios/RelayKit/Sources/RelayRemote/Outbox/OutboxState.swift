import Foundation

// mobile/src/remote/outbox-state.ts and Android's OutboxState.kt: the outbox's rules, apart from disk and link.

public struct Outgoing: Codable, Sendable, Equatable {
    /// The paired computer it's for; it only ever goes to that one.
    public var computer: String
    public var chatId: String
    public var send: ProjectChatSend
    public var created: Int64
    /// The desktop took it, at this `OutboxClock` stamp; it goes once the thread holds it.
    public var sent: Int64?
    public var error: String?
    /// No answer came back, so the desktop may have it all the same.
    public var unsure: Bool?
    /// The draft it came from, which the desktop holds part of: it goes through the desktop's composer.
    public var draft: String?

    public var id: String { send.id }

    public init(
        computer: String, chatId: String, send: ProjectChatSend, created: Int64, sent: Int64? = nil,
        error: String? = nil, unsure: Bool? = nil, draft: String? = nil
    ) {
        self.computer = computer
        self.chatId = chatId
        self.send = send
        self.created = created
        self.sent = sent
        self.error = error
        self.unsure = unsure
        self.draft = draft
    }
}

/// Orders the desktop's answers to sends against the thread fetches made on this phone.
@MainActor
public enum OutboxClock {
    private static var clock: Int64 = 0

    public static func stamp() -> Int64 {
        clock += 1
        return clock
    }
}

/// Every send the thread holds: as a message, waiting in its queue, or sent with Send later.
public func heldIds(_ thread: RemoteChat?) -> Set<String> {
    guard let thread else { return [] }
    var ids = Set(thread.messages.map(\.id))
    ids.formUnion((thread.queue ?? []).map(\.id))
    ids.formUnion((thread.scheduled ?? []).map(\.id))
    return ids
}

/// The sends done with once thread `chatId` reads as `held`, from a fetch made at `fetched`:
/// the ones it holds, and the ones the desktop took before that fetch which it holds nowhere any more.
public func settled(_ items: [Outgoing], computer: String, chatId: String, held: Set<String>, fetched: Int64)
    -> [Outgoing]
{
    items.filter {
        $0.computer == computer && $0.chatId == chatId && (held.contains($0.id) || ($0.sent.map { $0 < fetched } ?? false))
    }
}

/// How the thread shows one until the desktop's copy arrives.
public func outgoingMessage(_ o: Outgoing) -> ChatMessage {
    let images = (o.send.images ?? []).enumerated().map { i, image in
        ChatImage(
            id: "\(o.id):\(i)", name: image.name, mimeType: image.mimeType,
            sizeBytes: Int64((Double(image.dataUrl.utf8.count) * 3 / 4).rounded()))
    }
    return ChatMessage(
        id: o.id, role: "user", body: o.send.body, status: "complete", created: o.created, provider: o.send.provider,
        version: 0, error: o.error.map { o.unsure == true ? "Maybe not sent: \($0)" : "Not sent: \($0)" },
        side: o.send.side == true ? true : nil, images: images.isEmpty ? nil : images, parentId: o.send.parentId,
        pending: true)
}
