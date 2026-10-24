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
    /// The desktop answered with a refusal: only you trying again sends it again.
    public var refused: Bool?
    /// The draft it came from, which the desktop holds part of: it goes through the desktop's composer.
    public var draft: String?
    /// Files it takes along, uploaded before it goes; the body names each once it's on the computer.
    public var files: [FileAttachment]?

    public var id: String { send.id }

    public init(
        computer: String, chatId: String, send: ProjectChatSend, created: Int64, sent: Int64? = nil,
        error: String? = nil, unsure: Bool? = nil, refused: Bool? = nil, draft: String? = nil,
        files: [FileAttachment]? = nil
    ) {
        self.computer = computer
        self.chatId = chatId
        self.send = send
        self.created = created
        self.sent = sent
        self.error = error
        self.unsure = unsure
        self.refused = refused
        self.draft = draft
        self.files = files?.isEmpty == true ? nil : files
    }

    /// The send as it goes out: its files named where the computer keeps them.
    public var sending: ProjectChatSend {
        guard let files, !files.isEmpty else { return send }
        var send = send
        send.body = bodyWithFiles(send.body, files.map { $0.path ?? $0.name })
        return send
    }

    /// How far its files got, while any is still on its way to `computer`.
    public var uploadPercent: Int? {
        guard let files, files.contains(where: { !$0.uploaded(to: computer) }) else { return nil }
        let size = files.reduce(Int64(0)) { $0 + $1.size }
        let had = files.reduce(Int64(0)) { $0 + ($1.computer == computer ? min($1.received, $1.size) : 0) }
        return size > 0 ? Int((Double(had) * 100 / Double(size)).rounded(.down)) : 0
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
    // A file still on its way reads as a sent one does, by its name.
    var shown = o.send
    if let files = o.files {
        shown.body = bodyWithFiles(o.send.body, files.map { $0.path ?? "/pastes/\($0.id)/\($0.name)" })
    }
    return ChatMessage(
        id: o.id, role: "user", body: shown.body, status: "complete", created: o.created, provider: o.send.provider,
        version: 0, error: o.error.map { o.unsure == true ? "Maybe not sent: \($0)" : "Not sent: \($0)" },
        side: o.send.side == true ? true : nil, images: images.isEmpty ? nil : images, parentId: o.send.parentId,
        pending: true)
}
