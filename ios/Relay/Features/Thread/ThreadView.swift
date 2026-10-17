import RelayRemote
import SwiftUI

/// One thread: its messages, kept live by the desktop's events, and a composer.
struct ThreadView: View {
    let chatId: String
    /// A side conversation of the thread: the message it starts from, then the replies under it.
    var rootId: String?
    @Environment(Connection.self) private var connection
    @Environment(\.scenePhase) private var phase
    @Environment(\.navigate) private var navigate

    private var thread: RemoteChat? { connection.threads[chatId] }
    private var summary: RemoteChatSummary? { connection.chats.first { $0.id == chatId } }
    private var live: Bool { thread?.messages.last?.streaming == true }
    private var context: ContextUsage? { latestContext(connection.conversation(chatId, rootId: rootId)) }
    /// A model picked here; until then the thread's own.
    @State private var picked: ResumeSettings?
    @FocusState private var composing: Bool
    @State private var composer = ComposerHandle()
    /// Marked unread on the way out: a trailing seen mark mustn't clear it.
    @State private var leavingUnread = false

    /// A thread with nothing sent yet goes with what a new thread would.
    private var settings: Binding<ResumeSettings?> {
        Binding(
            get: { picked ?? connection.settings(of: chatId, rootId: rootId) ?? connection.newThread?.settings },
            set: { picked = $0 })
    }

    var body: some View {
        Group {
            if let thread {
                // Replies live in their side conversations.
                let shown = rootId.map { sideConversation(thread.messages, root: $0) } ?? mainMessages(thread.messages)
                let counts = rootId == nil ? replyCounts(thread.messages) : [:]
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        ForEach(shown) { message in
                            MessageView(
                                chatId: chatId, message: message, root: thread.root, replies: counts[message.id] ?? 0,
                                main: rootId == nil)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                // Built only once the thread is here, so it opens at the end.
                .followingEnd(live: live, last: shown.last?.id, mine: shown.last?.role == "user")
                .environment(\.renderCompose, { [composer] in composer.compose($0, $1) })
                // A drag or a tap on the thread puts the keyboard away; the tap still reaches what's under it.
                .scrollDismissesKeyboard(.immediately)
                .scrollEdgeEffectStyle(.soft, for: .bottom)
                .simultaneousGesture(
                    TapGesture().onEnded {
                        composing = false
                        TextSelection.clear()
                    })
            } else if let failed = connection.loadErrors[chatId] {
                ContentUnavailableView("Not loaded", systemImage: "exclamationmark.triangle", description: Text(failed))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // A bar rather than an inset: the thread blurs out under it, as it does under the title.
        .safeAreaBar(edge: .bottom) {
            if let requests = thread?.requests, let first = requests.first {
                RequestCard(chatId: chatId, request: first, more: requests.count - 1)
                    .id(first.id)
            } else {
                VStack(spacing: 0) {
                    if let thread, rootId == nil {
                        QueueList(chatId: chatId, thread: thread, running: summary?.running == true, takeBack: takeBack)
                    }
                    Composer(
                        chatId: chatId, rootId: rootId, projectId: thread?.projectId ?? summary?.projectId,
                        settings: settings, placeholder: rootId == nil ? "Message" : "Reply",
                        focused: $composing, handle: composer, onCommand: command
                    ) {
                        try await connection.send(
                            $0.text, images: $0.images, to: chatId, with: $0.settings, steer: $0.steer, rootId: rootId,
                            sendAt: $0.sendAt)
                    }
                }
            }
        }
        .relayBackground()
        .navigationTitle(rootId != nil ? "Replies" : thread?.title ?? summary?.title ?? "Thread")
        // Android's header line: how full the conversation's context is.
        .navigationSubtitle(contextPercent(context).map { "\($0)% context" } ?? "")
        .usageToolbar(
            provider: settings.wrappedValue?.provider, context: context,
            cost: thread.flatMap { $0.cost ?? threadCost($0.messages) },
            compact: { try await connection.compact(chatId, rootId: rootId) })
        .navigationBarTitleDisplayMode(.inline)
        // Open on the phone counts as read, but only while the app is in front:
        // answers that land in the background are marked when it comes back.
        .threadMenu(chatId: chatId, shown: rootId == nil, leavingUnread: $leavingUnread)
        .task(id: SeenMark(updated: summary?.updated, snoozedUntil: summary?.snoozedUntil, front: phase == .active,
                online: connection.status.state == .online)) {
            guard let updated = summary?.updated, phase == .active, !leavingUnread else { return }
            let until = summary?.snoozedUntil
            connection.markSeen(chatId, updated: updated, snoozedUntil: until)
            // Read on past the wake time when it comes while you're looking.
            guard let until, until > nowMs() else { return }
            try? await Task.sleep(for: .milliseconds(until + 1 - nowMs()))
            if !Task.isCancelled { connection.markSeen(chatId, updated: updated, snoozedUntil: until) }
        }
        .task(id: connection.status.state) {
            guard connection.status.state == .online else { return }
            await connection.load(chatId)
            if connection.settings(of: chatId) == nil { await connection.loadNewThread() }
        }
    }

    /// The composer gets the message before the queue lets it go, so a failure loses neither.
    /// Relay's own slash actions in a thread (Android's onCommand).
    private func command(_ name: String, _ args: String) async throws {
        guard let thread else { throw PairingError("Wait for the thread to load.") }
        switch name {
        case "new", "clear": navigate(.newThread(projectId: thread.projectId))
        case "compact": try await connection.compact(chatId, rootId: rootId, instructions: args)
        case "reload": try await connection.reloadSession(chatId)
        default: throw PairingError("Open that one on your computer for now.")
        }
    }

    private func takeBack(_ item: RemoteQueued) async throws {
        let back = TakenBack(item)
        // Only a computer that sends `settings` can hand the photos over; older ones give the text alone.
        let images =
            (item.images ?? 0) > 0 && item.settings != nil ? try await connection.queuedImages(chatId, item: item.id) : []
        let undo = try composer.restore(back.body, images)
        do {
            try await connection.queue(chatId, .remove, messageId: item.id)
        } catch {
            undo()
            throw error
        }
        if let settings = back.settings { picked = settings }
        composing = true
    }
}

private struct SeenMark: Equatable {
    let updated: Int64?
    let snoozedUntil: Int64?
    let front: Bool
    let online: Bool
}
