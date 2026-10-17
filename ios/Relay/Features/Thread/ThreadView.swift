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
    /// A reply's conversation runs while one of its answers does.
    private var running: Bool {
        rootId == nil ? thread?.running ?? summary?.running ?? false : connection.running(chatId, rootId: rootId)
    }
    /// The agent whose plan waits for a go-ahead here.
    private var plan: String? {
        guard !running, let thread else { return nil }
        return openPlan(thread.messages, view: connection.conversation(chatId, rootId: rootId))
    }
    private var context: ContextUsage? { latestContext(connection.conversation(chatId, rootId: rootId)) }
    /// One made here has no summary until its first message is in.
    private var made: Made? { MadeHere.of(chatId) }
    /// Under the title, as on Android: the branch, the model and its effort, how full the context is.
    private var headerLine: String {
        let branch = thread?.worktree?.branch ?? summary?.branch
        let model = settings.wrappedValue.map { $0.modelLabel(connection.catalogs[$0.provider]) }
        let full = contextPercent(context).map { "\($0)% context" }
        return [branch, model, full].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
    }

    private var projectId: String? { thread?.projectId ?? summary?.projectId ?? made?.projectId }
    /// Replies live in their side conversations. This phone's sends the thread doesn't hold yet
    /// come last, shown at once, before the thread itself has loaded.
    private var shown: [ChatMessage] { connection.conversation(chatId, rootId: rootId) + connection.outgoing(chatId, rootId: rootId) }
    /// A note's message to scroll to.
    @State private var jump: MessageJump?
    /// A model picked here; until then the thread's own.
    @State private var picked: ResumeSettings?
    @FocusState private var composing: Bool
    @State private var composer = ComposerHandle()
    /// Marked unread on the way out: a trailing seen mark mustn't clear it.
    @State private var leavingUnread = false
    @State private var notes = ThreadNotesEntry()
    @State private var viewing: Viewing?
    @Namespace private var pictures

    /// A thread with nothing sent yet goes with what a new thread would.
    private var settings: Binding<ResumeSettings?> {
        Binding(
            get: { picked ?? connection.settings(of: chatId, rootId: rootId) ?? connection.newThread?.settings },
            set: { picked = $0 })
    }

    var body: some View {
        Group {
            let shown = self.shown
            if thread != nil || !shown.isEmpty {
                let counts = rootId == nil ? replyCounts(thread?.messages ?? []) : [:]
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        if rootId == nil, let earlier = thread?.earlier, earlier > 0 {
                            EarlierMessages(chatId: chatId, earlier: earlier)
                        }
                        ForEach(shown) { message in
                            MessageView(
                                chatId: chatId, message: message, root: thread?.root, replies: counts[message.id] ?? 0,
                                main: rootId == nil)
                            if rootId == nil { WorkspaceMoveLine(moves: thread?.workspaceMoves, messageId: message.id) }
                        }
                        if running, let newest = shown.last, newest.role == "user" {
                            AwaitingAnswer(provider: settings.wrappedValue?.provider ?? thread?.settings?.provider ?? "claude", seed: newest.id)
                        }
                        if let thread, canResume(thread, conversation: shown, rootId: rootId, running: running) {
                            ResumeAnswer(chatId: chatId, settings: settings.wrappedValue ?? thread.settings)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    // Room under the last line, as on the desktop, so a turn's end doesn't sit on the composer.
                    .padding(.bottom, 60)
                }
                // Built only once the thread is here, so it opens at the end.
                .followingEnd(live: live, last: shown.last?.id, mine: shown.last?.role == "user", jump: jump)
                .environment(\.renderCompose, { [composer] in composer.compose($0, $1) })
                .environment(\.quoteMessage, { [composer] in composer.quote($0) })
                .environment(\.openImage, OpenImage(space: pictures) { source, among in
                    // The list is fixed while it's open; ones that failed to load are left out.
                    let shown = among.filter { $0.source == source || !Pictures.failed($0.source, connection) }
                    if let index = shown.firstIndex(where: { $0.source == source }) {
                        viewing = Viewing(images: shown, index: index)
                    }
                })
                // A drag or a tap on the thread puts the keyboard away; the tap still reaches what's under it.
                .scrollDismissesKeyboard(.immediately)
                .scrollEdgeEffectStyle(.soft, for: .bottom)
                .simultaneousGesture(
                    TapGesture().onEnded {
                        composing = false
                        TextSelection.clear()
                    })
            } else if connection.status.state != .online {
                ContentUnavailableView(
                    "Not on this phone yet", systemImage: "icloud.slash",
                    description: Text(
                        "This thread hasn’t been opened on this phone, so there’s no copy to read until \(connection.overview?.name ?? "your computer") is back."))
            } else if let failed = connection.loadErrors[chatId] {
                ContentUnavailableView {
                    Label("Not loaded", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(failed)
                } actions: {
                    Button("Try again") { Task { await connection.load(chatId) } }
                }
            } else {
                Spinner.page
            }
        }
        // A bar rather than an inset: the thread blurs out under it, as it does under the title.
        .safeAreaBar(edge: .bottom) {
            VStack(spacing: 0) {
                if rootId == nil {
                    ThreadDock(chatId: chatId, thread: thread, summary: summary, running: running)
                }
                if let requests = thread?.requests, let first = requests.first {
                    RequestCard(chatId: chatId, request: first, more: requests.count - 1)
                        .id(first.id)
                } else {
                    VStack(spacing: 0) {
                        if let thread, rootId == nil {
                            QueueList(chatId: chatId, thread: thread, running: summary?.running == true, takeBack: takeBack)
                        }
                        if let planner = plan {
                            ImplementPlan(chatId: chatId, rootId: rootId, planner: planner, settings: settings)
                        }
                        UnsentList(chatId: chatId, rootId: rootId, restore: { [composer] in try composer.restore($0, $1) })
                        Composer(
                            chatId: chatId, rootId: rootId, projectId: projectId,
                            draftKey: rootId.map { "\(chatId):\($0)" } ?? chatId, settings: settings, placeholder: rootId == nil ? "Message" : "Reply",
                            focused: $composing, handle: composer, onCommand: command
                        ) {
                            try await connection.send(
                                $0.text, images: $0.images, to: chatId, with: $0.settings, steer: $0.steer, rootId: rootId,
                                sendAt: $0.sendAt, throughDraft: $0.throughDraft, id: $0.id)
                        }
                    }
                }
            }
            // Over the dock's top edge rather than in the bar, so the title gets the room and the
            // thread keeps its height; at the end it sits in the gap under the last line.
            .overlay(alignment: .topTrailing) {
                UsageBubble(
                    provider: settings.wrappedValue?.provider, context: context,
                    cost: thread.flatMap { $0.cost ?? threadCost($0.messages) },
                    compact: { try await connection.compact(chatId, rootId: rootId) }
                )
                .padding(.trailing, 20)
                .alignmentGuide(.top) { $0[.bottom] + 10 }
            }
        }
        .relayBackground()
        .fullScreenCover(item: $viewing) { Lightbox($0, space: pictures) }
        .navigationTitle(rootId != nil ? "Replies" : thread?.title ?? summary?.title ?? made?.title ?? "Thread")
        .navigationSubtitle(headerLine)
        .ciStatus(projectId: projectId, chatId: chatId, running: summary?.running == true, shown: rootId == nil)
        .navigationBarTitleDisplayMode(.inline)
        // Open on the phone counts as read, but only while the app is in front:
        // answers that land in the background are marked when it comes back.
        .threadMenu(chatId: chatId, shown: rootId == nil, notes: $notes, leavingUnread: $leavingUnread)
        .threadNotes(chatId: chatId, shown: rootId == nil, entry: $notes, present: Set(shown.map(\.id))) { [composer] in
            composer.compose($0, nil)
        } show: { jump = MessageJump(id: $0) }
        .turnHaptics(rootId == nil ? summary : nil, answer: thread.flatMap { mainMessages($0.messages).last(where: isAnswer) })
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
        // A queued reply taken back on the main screen arrives here, once the composer is up.
        .task(id: thread != nil) {
            guard thread != nil, let rootId, let item = HandedBacks.take("\(chatId):\(rootId)") else { return }
            await Task.yield()
            do { try await takeBack(item) } catch { HandedBacks.hand("\(chatId):\(rootId)", item) }
        }
        .task(id: connection.status.state) {
            connection.openSaved(chatId)
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
        case "files": navigate(.files(place: thread.bridgeWhere))
        case "changes": navigate(.git(.changes(where: thread.gitWhere)))
        case "openpr": try await openPullRequest(thread, connection)
        default: throw PairingError("Open that one on your computer for now.")
        }
    }

    private func takeBack(_ item: RemoteQueued) async throws {
        // A queued reply goes back in its side conversation, whose screen takes it out of the queue.
        if rootId == nil, let parentId = item.parentId {
            HandedBacks.hand("\(chatId):\(parentId)", item)
            return navigate(.replies(chatId: chatId, rootId: parentId))
        }
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
