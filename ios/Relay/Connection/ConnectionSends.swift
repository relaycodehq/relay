import Foundation
import RelayRemote

/// The outbox and the offline copies, as the connection feeds them.
extension Connection {
    /// Goes in the background: the thread shows it at once, a failure stays there to retry or take back.
    func deliver(
        _ send: ProjectChatSend, to chatId: String, through client: RemoteClient, computer: String, draft: String? = nil,
        files: [FileAttachment] = []
    ) {
        outbox.deliver(ClientOutboxLink(client), computer: computer, chatId: chatId, send, draft: draft, files: files)
    }

    /// Why this computer can't take files, once it has said which bridge it speaks.
    var filesRefused: String? {
        guard let overview else { return nil }
        return (overview.bridge ?? 0) < Bridge.files ? Files.needsUpdate : nil
    }

    /// Sends what the computer doesn't have yet of a file the composer holds, trying again a few
    /// times as the outbox does; the outbox carries on from what it got to.
    func uploadFile(
        _ file: FileAttachment, progress: @escaping @Sendable (FileAttachment) async -> Void
    ) async throws -> FileAttachment {
        guard let active, let folder = outbox.files else { throw PairingError("Not connected.") }
        let link = link
        return try await retrying {
            try await upload(file, from: folder.url(file), to: active, via: link, progress: progress)
        }
    }

    /// A send that goes straight to the computer, not through the outbox, with its files uploaded
    /// first and named in it. Their copies go once it's sent.
    func withFiles(_ send: ProjectChatSend, _ files: [FileAttachment]) async throws -> ProjectChatSend {
        guard !files.isEmpty else { return send }
        var done: [FileAttachment] = []
        for file in files { done.append(try await uploadFile(file) { _ in }) }
        var send = send
        send.body = bodyWithFiles(send.body, done.compactMap(\.path))
        return send
    }

    func letGo(_ files: [FileAttachment]) {
        for file in files { outbox.files?.remove(file) }
    }

    /// The desktop took one the thread doesn't show yet: ask for it.
    func sentFromHere(_ sent: Outgoing) {
        guard threads[sent.chatId] != nil, !heldIds(threads[sent.chatId]).contains(sent.id) else { return }
        Task { await load(sent.chatId) }
    }

    /// The thread as just fetched (`fetched` is the stamp from before the ask) or as an event left
    /// it: the sends it holds are done with.
    func took(_ chatId: String, _ thread: RemoteChat, fetched: Int64) {
        guard let active else { return }
        outbox.arrived(computer: active, chatId: chatId, held: heldIds(thread), fetched: fetched)
    }

    /// The list as the events left it, saved a moment after they settle.
    func cacheSoon() {
        caching?.cancel()
        caching = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !Task.isCancelled, let active, var overview else { return }
            overview.chats = chats
            overview.present = nil
            let cache = cache
            await Task.detached(priority: .utility) { cache.save(active, overview) }.value
        }
    }

    /// This phone's sends the thread doesn't hold yet, as messages in their conversation.
    func outgoing(_ chatId: String, rootId: String? = nil) -> [ChatMessage] {
        guard let active else { return [] }
        let held = heldIds(threads[chatId])
        return outbox.of(computer: active, chatId: chatId)
            .filter { !held.contains($0.id) && $0.send.parentId == rootId }
            .map(outgoingMessage)
    }

    /// Ones the computer didn't take, to try again or take back.
    func unsent(_ chatId: String, rootId: String? = nil) -> [Outgoing] {
        guard let active else { return [] }
        let held = heldIds(threads[chatId])
        return outbox.of(computer: active, chatId: chatId)
            .filter { $0.error != nil && !held.contains($0.id) && $0.send.parentId == rootId }
    }

    func retry(_ o: Outgoing) {
        outbox.retry(link, o.id)
    }

    /// Whether the computer has an unanswered one already, which taken back would go twice.
    func reached(_ o: Outgoing) async throws -> Bool {
        try await outbox.reached(link, o)
    }

    var routes: [RouteKind] { computer?.routes ?? Routes.defaultOrder }
}
