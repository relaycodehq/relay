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

    /// Whether the computer takes a thread id from the phone, so a new thread opens at once (`Bridge.phoneThreadId`).
    var namesThreads: Bool { (overview?.bridge ?? 0) >= Bridge.phoneThreadId }

    /// A new thread that opens at once, however slow the link: the outbox makes it, then sends
    /// its first message. Its id, which this phone chose.
    func startInOutbox(
        in projectId: String, workspace: String?, _ text: String, images: [PastedImage], files: [FileAttachment],
        with settings: ResumeSettings, id: String, on computer: String
    ) throws -> String {
        guard active == computer else { throw PairingError("The computer changed. Send again on the computer you want.") }
        let threadId = UUID().uuidString.lowercased()
        let send = threadSend(text, images: images, to: threadId, with: settings, steer: false, rootId: nil, sendAt: nil, id: id)
        let thread = ThreadToMake(projectId: projectId, workspace: workspace)
        outbox.deliver(outboxLink, computer: computer, chatId: threadId, send, files: files, make: thread)
        return threadId
    }

    /// The message `send` makes of a thread composer's text.
    func threadSend(
        _ text: String, images: [PastedImage] = [], to chatId: String, with settings: ResumeSettings, steer: Bool,
        rootId: String?, sendAt: Int64?, id: String = UUID().uuidString.lowercased()
    ) -> ProjectChatSend {
        let delivery = sendAt != nil || !running(chatId, rootId: rootId) ? nil : steer ? "steer" : "queue"
        let btw = rootId == nil ? text.range(of: "^/btw\\s+", options: [.regularExpression, .caseInsensitive]) : nil
        return ProjectChatSend(
            id: id, body: btw.map { String(text[$0.upperBound...]) } ?? text, settings: settings, delivery: delivery,
            images: images, parentId: rootId, side: btw != nil, sendAt: sendAt)
    }

    /// The tokens a message would compact first, its conversation's cache gone cold, so the
    /// composer asks before it goes; nil when there's nothing to ask.
    func coldCompactTokens(
        _ text: String, to chatId: String, with settings: ResumeSettings, steer: Bool, rootId: String?, sendAt: Int64?
    ) -> Int64? {
        guard (overview?.bridge ?? 0) >= Bridge.coldCompact, let thread = threads[chatId] else { return nil }
        // A /btw thread's own session never compacts.
        let sideThread = rootId.flatMap { root in thread.messages.first { $0.id == root } }?.side == true
        if sideThread { return nil }
        let held = heldIds(thread)
        let outgoing = active.map { outbox.of(computer: $0, chatId: chatId) } ?? []
        let queueWaiting = !(thread.queue ?? []).isEmpty || thread.queuePaused == true
            || outgoing.contains { !held.contains($0.id) && $0.send.parentId == rootId }
        let conversation = conversation(chatId, rootId: rootId)
        let send = threadSend(text, to: chatId, with: settings, steer: steer, rootId: rootId, sendAt: sendAt)
        return RelayRemote.coldCompactTokens(
            conversation, holder: contextAgent(conversation, rootId: rootId), send: send, queueWaiting: queueWaiting,
            now: Int64(Date().timeIntervalSince1970 * 1000))
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
        // A thread this phone named has no copy until the computer has made it and taken this.
        let madeHere = MadeHere.of(sent.chatId) != nil
        guard threads[sent.chatId] != nil || madeHere, !heldIds(threads[sent.chatId]).contains(sent.id) else { return }
        Task { await load(sent.chatId) }
    }

    /// The thread as just fetched (`fetched` is the stamp from before the ask) or as an event left
    /// it: the sends it holds are done with.
    func took(_ chatId: String, _ thread: RemoteChat, fetched: Int64) {
        guard let active else { return }
        outbox.arrived(computer: active, chatId: chatId, held: heldIds(thread), fetched: fetched)
    }

    /// Copies the latest threads for reading offline while the link is up. The overview counts
    /// as a list too: after a (re)connect the computer sends no list until a thread moves.
    func readAheadLatest() {
        guard let active, status.state == .online else { return }
        let wanted = ReadAhead.wanted(chats, computer: active)
        Task { [readAhead] in await readAhead?.want(wanted) }
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
