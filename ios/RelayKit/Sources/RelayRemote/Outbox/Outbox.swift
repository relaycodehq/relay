import Foundation
import Observation

/// What the outbox sends through: the live connection, or one that refuses.
public protocol OutboxLink: FileUploading {
    func send(chatId: String, _ send: ProjectChatSend) async throws
    /// A send of a draft the desktop holds part of, through its composer.
    func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws
    /// The thread with a receipt for `sendId`.
    func chat(_ chatId: String, sendId: String) async throws -> RemoteChat
}

public extension OutboxLink {
    func uploadFile(id: String, name: String, size: Int64, offset: Int64, data: String) async throws -> UploadedFile {
        throw RemoteCallError.rejected(Files.needsUpdate)
    }
}

/// Through `client`, or refusing when there's none.
public struct ClientOutboxLink: OutboxLink {
    let client: RemoteClient?

    public init(_ client: RemoteClient?) { self.client = client }

    private func live() throws -> RemoteClient {
        guard let client else { throw RemoteCallError.notConnected("Not connected to your computer.") }
        return client
    }

    public func send(chatId: String, _ send: ProjectChatSend) async throws {
        try await live().sendProjectChat(chatId: chatId, send)
    }

    public func sendDraft(key: String, chatId: String, _ send: ProjectChatSend) async throws {
        _ = try await live().sendDraft(key: key, chatId: chatId, send)
    }

    public func chat(_ chatId: String, sendId: String) async throws -> RemoteChat {
        try await live().chat(chatId, history: Bridge.remoteHistory, sendId: sendId)
    }

    public func uploadFile(id: String, name: String, size: Int64, offset: Int64, data: String) async throws -> UploadedFile {
        let client = try live()
        // The bridge is forgotten while the link is down; that's a wait, not a refusal.
        guard let bridge = await client.bridge else { throw RemoteCallError.notConnected("Not connected to your computer.") }
        guard bridge >= Bridge.files else { throw RemoteCallError.rejected(Files.needsUpdate) }
        return try await client.uploadFile(id: id, name: name, size: size, offset: offset, data: data)
    }
}

/// mobile/src/remote/outbox.ts and Android's Outbox.kt: messages on their way to the desktop.
/// The thread shows one at once and the composer is free again; a failed one stays to try again
/// or take back. Until the desktop has it, it's also kept on disk, so a send cut short by iOS
/// closing the app goes out on the next launch.
@MainActor
@Observable
public final class Outbox {
    public private(set) var items: [Outgoing] = []

    @ObservationIgnored private let dir: URL?
    /// Where the files sends take along are kept until the computer has them.
    @ObservationIgnored public let files: FileFolder?
    /// How long a failed upload waits before each try again.
    @ObservationIgnored public var retryDelays = Files.retryDelays
    @ObservationIgnored private let now: () -> Int64
    /// Sends on their way right now, by id.
    @ObservationIgnored private var inFlight: [String: (token: UUID, task: Task<Void, Never>)] = [:]
    /// Being asked about to take back for an edit; not sent again meanwhile.
    @ObservationIgnored private var takingBack: Set<String> = []
    /// Told when the desktop took one, so the thread can be fetched for it.
    @ObservationIgnored public var onSent: ((Outgoing) -> Void)?

    public init(
        dir: URL?, files: URL? = nil, now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.dir = dir
        self.files = files.map(FileFolder.init)
        self.now = now
        items = kept()
        // Copies of files only an earlier run's composer had, or whose send is gone, go.
        self.files?.sweep(keeping: items.flatMap { $0.files ?? [] })
    }

    private func shelved(_ id: String) -> URL? { dir?.appending(path: "\(id).json") }

    private func keep(_ o: Outgoing) {
        guard let dir, let file = shelved(o.id) else { return }
        var copy = o
        copy.sent = nil
        // A refusal stays refused across launches; only trying again lifts it.
        if o.refused != true {
            copy.error = nil
            copy.unsure = nil
            copy.refused = nil
        }
        // A full disk costs the copy; the send itself still goes.
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? JSONEncoder().encode(copy).write(to: file, options: .atomic)
    }

    private func unkeep(_ id: String) {
        guard let file = shelved(id) else { return }
        try? FileManager.default.removeItem(at: file)
    }

    /// Done with its files: the computer has the send, or it's gone.
    private func letGo(_ o: Outgoing) {
        for file in o.files ?? [] { files?.remove(file) }
    }

    /// The ones the last run never got to the desktop, failed until they go again.
    private func kept() -> [Outgoing] {
        guard let dir, let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        else { return [] }
        return files.filter { $0.pathExtension == "json" }
            .compactMap { file -> Outgoing? in
                guard var o = try? JSONDecoder().decode(Outgoing.self, from: Data(contentsOf: file)) else { return nil }
                if o.refused == true { return o }
                o.error = "Relay closed before it went out"
                // With a file still on its way, the send itself never went.
                o.unsure = o.files?.contains { !$0.uploaded(to: o.computer) } == true ? nil : true
                return o
            }
            .sorted { $0.created < $1.created }
    }

    private func update(_ id: String, _ change: (inout Outgoing) -> Void) {
        guard let at = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[at])
    }

    private func run(_ link: OutboxLink, _ item: Outgoing) {
        let id = item.id
        let token = UUID()
        let task = Task { [weak self] in
            var item = item
            do {
                item.files = try await self?.uploaded(item, through: link) ?? item.files
            } catch {
                // Not sent at all: only the upload failed, so nothing about the send is in doubt.
                guard let self else { return }
                let refused = if case RemoteCallError.rejected = error { true } else { false }
                update(id) {
                    $0.error = error is CancellationError ? "Stopped" : error.localizedDescription
                    $0.refused = refused ? true : nil
                }
                if let kept = items.first(where: { $0.id == id }) { keep(kept) }
                if self.inFlight[id]?.token == token { self.inFlight[id] = nil }
                return
            }
            do {
                if let draft = item.draft {
                    try await link.sendDraft(key: draft, chatId: item.chatId, item.sending)
                } else {
                    try await link.send(chatId: item.chatId, item.sending)
                }
                guard let self else { return }
                unkeep(id)
                letGo(item)
                update(id) {
                    $0.sent = OutboxClock.stamp()
                    $0.error = nil
                    $0.unsure = nil
                    $0.refused = nil
                }
                if let sent = items.first(where: { $0.id == id }) { onSent?(sent) }
            } catch {
                guard let self else { return }
                // A refused retry doesn't prove that an earlier unanswered copy failed.
                let unanswered = if case RemoteCallError.unanswered = error { true } else { false }
                let refused = if case RemoteCallError.rejected = error { true } else { false }
                update(id) {
                    $0.error = error.localizedDescription
                    $0.unsure = item.unsure == true || unanswered
                    $0.refused = refused ? true : nil
                }
                if refused, let kept = items.first(where: { $0.id == id }) { keep(kept) }
            }
            if let self, self.inFlight[id]?.token == token { self.inFlight[id] = nil }
        }
        inFlight[id] = (token, task)
    }

    /// Its files on `link`'s computer, sending what it doesn't have yet; each step is kept, so a
    /// later try, or the next launch, carries on from there.
    private func uploaded(_ item: Outgoing, through link: OutboxLink) async throws -> [FileAttachment]? {
        guard var list = item.files, let folder = files else { return item.files }
        let id = item.id
        for at in list.indices where !list[at].uploaded(to: item.computer) {
            let file = list[at]
            let url = folder.url(file)
            guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else {
                throw RemoteCallError.rejected("\(file.name) isn't on this phone anymore.")
            }
            list[at] = try await retrying(retryDelays) {
                let start = items.first { $0.id == id }?.files?[at] ?? file
                return try await upload(start, from: url, to: item.computer, via: link) { [weak self] step in
                    await self?.stepped(id, at, step)
                }
            }
            stepped(id, at, list[at], keeping: true)
        }
        return list
    }

    /// A file's upload moved on; kept on disk only now and then, as each chunk would be a write.
    private func stepped(_ id: String, _ at: Int, _ file: FileAttachment, keeping: Bool = false) {
        update(id) { o in
            guard o.files?.indices.contains(at) == true else { return }
            o.files?[at] = file
        }
        if keeping || file.received % Int64(Files.chunk * 8) == 0, let o = items.first(where: { $0.id == id }) {
            keep(o)
        }
    }

    /// How far a send's files got, while they're still going; nil for one without or past that.
    public func uploadPercent(_ id: String) -> Int? {
        guard let o = items.first(where: { $0.id == id }), o.error == nil else { return nil }
        return o.uploadPercent
    }

    /// Sends in the background; the desktop drops a second copy of the same id, so trying again is safe.
    public func deliver(
        _ link: OutboxLink, computer: String, chatId: String, _ send: ProjectChatSend, draft: String? = nil,
        files: [FileAttachment] = []
    ) {
        let item = Outgoing(computer: computer, chatId: chatId, send: send, created: now(), draft: draft, files: files)
        keep(item)
        items.append(item)
        run(link, item)
    }

    public func retry(_ link: OutboxLink, _ id: String) {
        guard var item = items.first(where: { $0.id == id }), !takingBack.contains(id) else { return }
        update(id) {
            $0.error = nil
            $0.refused = nil
        }
        item.error = nil
        item.refused = nil
        keep(item)
        run(link, item)
    }

    /// Back online: the ones the lost link stopped go out again by themselves; a refused one
    /// would only be refused again.
    public func resendFailed(_ link: OutboxLink, computer: String) {
        for o in items where o.error != nil && o.refused != true && o.computer == computer { retry(link, o.id) }
    }

    /// Still waiting here, unsent or failed.
    public func isOut(_ id: String) -> Bool { items.contains { $0.id == id } }

    public func drop(_ id: String) {
        unkeep(id)
        if let o = items.first(where: { $0.id == id }) { letGo(o) }
        items.removeAll { $0.id == id }
    }

    /// Takes one back to edit with its files, which the composer looks after from then on.
    public func takeBack(_ id: String) {
        unkeep(id)
        items.removeAll { $0.id == id }
    }

    /// Forgets the ones thread `chatId` now holds itself, or no longer does, reading as `held`
    /// from a fetch made at `fetched`.
    public func arrived(computer: String, chatId: String, held: Set<String>, fetched: Int64) {
        let done = Set(settled(items, computer: computer, chatId: chatId, held: held, fetched: fetched).map(\.id))
        guard !done.isEmpty else { return }
        done.forEach(unkeep)
        for o in items where done.contains(o.id) { letGo(o) }
        items.removeAll { done.contains($0.id) }
    }

    /// Whether the desktop has one it never answered for: taken back to edit and sent again, it would go twice.
    public func reached(_ link: OutboxLink, _ o: Outgoing) async throws -> Bool {
        let id = o.id
        // A copy still on its way, or resent as the link comes back, would land after a "no".
        takingBack.insert(id)
        defer { takingBack.remove(id) }
        await inFlight[id]?.task.value
        let thread = try await link.chat(o.chatId, sendId: id)
        guard let has = thread.hasSend else {
            throw RemoteCallError.rejected("Update Relay on your computer before taking back an unanswered send.")
        }
        // A receipt covers the full history, including an accepted send outside this page.
        if has && thread.sendPending != true { drop(id) }
        return has
    }

    public func of(computer: String, chatId: String) -> [Outgoing] {
        items.filter { $0.computer == computer && $0.chatId == chatId }
    }

    /// A pasted image of one still on its way, which the desktop can't hand back yet; `imageId` is `<send>:<index>`.
    public func outgoingImage(_ imageId: String) -> String? {
        guard let colon = imageId.lastIndex(of: ":"), let index = Int(imageId[imageId.index(after: colon)...]) else {
            return nil
        }
        let id = String(imageId[..<colon])
        guard let images = items.first(where: { $0.id == id })?.send.images, images.indices.contains(index) else {
            return nil
        }
        return images[index].dataUrl
    }

    /// A forgotten computer's sends go with it.
    public func forget(computer: String) {
        for o in items where o.computer == computer {
            unkeep(o.id)
            letGo(o)
        }
        items.removeAll { $0.computer == computer }
    }
}
