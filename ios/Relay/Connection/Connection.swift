import Foundation
import Observation
import OSLog
import RelayRemote
import UIKit

let log = Logger(subsystem: "dev.relay.ios", category: "connection")

/// The app's link to the active computer: its paired computers, the live
/// client, and what the desktop last said (threads, projects, open threads).
@Observable
final class Connection {
    private(set) var computers: [RemoteCredentials] = []
    private(set) var active: String?
    private(set) var status = RemoteStatus(.offline)
    /// The last attempt to reach the computer failed. Each retry passes through Connecting, so
    /// what shows the link holds on to this until one gets through, rather than flipping each time.
    private(set) var failing = false
    private(set) var overview: RemoteOverview?
    private(set) var chats: [RemoteChatSummary] = []
    /// Someone at the computer working in Relay.
    private(set) var present: Bool?
    /// Threads opened on this phone, kept current by message events.
    private(set) var threads: [String: RemoteChat] = [:]
    /// Why a thread didn't load, by id; cleared when it does.
    private(set) var loadErrors: [String: String] = [:]
    /// Each agent's models, asked once per connection.
    private(set) var catalogs: ModelCatalogs = [:]
    /// Each agent's plan limits, as last reported.
    private(set) var usage: [String: ProviderUsage] = [:]
    /// The agents' own commands, by project and agent.
    private var commandLists: [String: [ProviderCommand]] = [:]
    /// Agents' pages, by computer, thread, page set and page.
    @ObservationIgnored private var pages: [String: String] = [:]
    /// The phone's listeners for the computer's localhost, for the app's life: each
    /// connection lends them its tunnel.
    @ObservationIgnored let tunnels = TunnelListeners()
    /// Which of each computer's ports the browser may open: listed in Sites, or typed.
    @ObservationIgnored let tunnelPorts = TunnelPorts()
    /// What a new thread opens on, and each agent's remembered model; asked once per connection,
    /// the copy saved last time standing in until then.
    private(set) var newThread: (settings: ResumeSettings, models: NewThreadModels)?
    /// The agents listed and the new thread asked on this connection, past the saved copies.
    private var listedModels: Set<String> = []
    private var askedNewThread = false
    /// The agents as Settings → Agents orders and switches them; asked once per
    /// connection, and again each time the model sheet opens.
    private(set) var agentPrefs: NewThreadAI?
    private var askedAgentPrefs = false
    /// Bumped per ask, so an older answer arriving late can't undo a newer one.
    @ObservationIgnored private var agentPrefsAsk = 0
    @ObservationIgnored private let saves = ComposerSaves()
    /// Which threads moved since this phone last looked, kept past a restart.
    private(set) var seen = Connection.loadSeen()
    /// Unsent composer text per computer, kept here and shared with the computer.
    @ObservationIgnored let drafts = DraftStore(dir: URL.applicationSupportDirectory.appending(path: "relay-drafts"))
    /// Threads kept for reading offline, by computer.
    @ObservationIgnored let offline = ThreadCache(root: URL.cachesDirectory.appending(path: "relay-offline"))
    /// Copies the latest threads before they're opened; one per connection.
    @ObservationIgnored private var readAhead: ReadAhead?
    /// How many of a thread's latest messages to hold, where Load earlier asked for more.
    private(set) var history: [String: Int] = [:]
    /// Messages on their way to a computer, shown in their threads until it has them (ConnectionSends.swift).
    let outbox = Outbox(dir: URL.applicationSupportDirectory.appending(path: "relay-outbox"))
    /// Each computer's last overview, shown while it can't be reached.
    @ObservationIgnored let cache = OfflineCache(dir: URL.cachesDirectory.appending(path: "relay-overview"))
    /// When this phone last reached each computer, by key.
    private(set) var reached = ComputerSeen.app.load()
    /// Which way the link runs now; nil while it's down.
    private(set) var route: RemoteRoute?
    /// Other threads finishing, failing or needing you, told while the app is open.
    @ObservationIgnored let notices = ThreadNotices()
    @ObservationIgnored var caching: Task<Void, Never>?

    private var client: RemoteClient?
    private var listening: Task<Void, Never>?
    /// Projects threads point at that the overview doesn't list yet, and the refetch for them.
    private var missing = MissingProjects()
    private var missingRefetch: Task<Void, Never>?
    private let store: CredentialStore
    @ObservationIgnored private let makeClient: (RemoteStart) -> RemoteClient

    init(
        store: CredentialStore = CredentialStore(),
        makeClient: @escaping (RemoteStart) -> RemoteClient = { RemoteClient($0) }
    ) {
        self.store = store
        self.makeClient = makeClient
    }

    var computer: RemoteCredentials? { computers.first { $0.key == active } }
    var paired: Bool { computer != nil }
    var outdated: Bool { (overview?.bridge ?? Bridge.oldestCurrent) < Bridge.oldestCurrent }

    func project(_ id: String) -> RemoteProject? { overview?.projects.first { $0.id == id } }

    func launch() {
        let saved = store.load()
        computers = saved.computers
        active = saved.active ?? saved.computers.last?.key
        outbox.onSent = { [weak self] sent in self?.sentFromHere(sent) }
        if let computer { connect(.saved(computer)) }
    }

    /// Back in the foreground: reconnect now if the link went quiet.
    func wake() {
        guard let client else { return }
        Task { await client.wake() }
    }

    /// Trades the link's one-time code for a login, then makes that computer
    /// the active one. Throws with the desktop's reason when it refuses; the
    /// computer before stays active then.
    func pair(_ link: PairingLink) async throws {
        let before = active
        let pairing = makeClient(.pair(link, device: UIDevice.current.name))
        let result = try await withThrowingTaskGroup(of: RemoteCredentials?.self) { group in
            group.addTask {
                var credentials: RemoteCredentials?
                for await update in pairing.updates {
                    switch update {
                    case .paired(let c): credentials = c
                    case .status(let s) where s.state == .online: return credentials
                    case .status(let s) where s.state == .denied:
                        throw PairingError(s.detail ?? "Relay refused this phone.")
                    case .status(let s) where s.state == .offline && credentials == nil:
                        throw PairingError(s.detail ?? "Can't reach \(link.name).")
                    default: break
                    }
                }
                return credentials
            }
            group.addTask {
                // Longer than a route's own 15s, so their reason is what's shown.
                try await Task.sleep(for: .seconds(20))
                return nil
            }
            await pairing.start()
            defer { group.cancelAll() }
            return try await group.next() ?? nil
        }
        await pairing.close()
        guard let result else {
            active = before
            throw PairingError("\(link.name) didn't answer. Check that this phone can reach it, then try again.")
        }
        computers.removeAll { $0.key == result.key }
        computers.append(result)
        active = result.key
        store.save(computers, active: active)
        connect(.saved(result))
    }

    func forget(_ key: String) {
        computers.removeAll { $0.key == key }
        drafts.forget(key)
        saves.forget(key)
        cache.forget(key)
        outbox.forget(computer: key)
        reached[key] = nil
        ComputerSeen.app.save(reached)
        offline.forget(key)
        if active == key {
            active = computers.last?.key
            disconnect()
            if let computer { connect(.saved(computer)) }
        }
        store.save(computers, active: active)
    }

    func switchTo(_ key: String) {
        guard key != active, let next = computers.first(where: { $0.key == key }) else { return }
        active = key
        store.save(computers, active: active)
        connect(.saved(next))
    }

    private func disconnect() {
        listening?.cancel()
        if let client { Task { await client.close() } }
        client = nil
        tunnels.streams = nil
        status = RemoteStatus(.offline)
        failing = false
        overview = nil
        chats = []
        threads = [:]
        history = [:]
        readAhead = nil
        present = nil
        catalogs = [:]
        commandLists = [:]
        usage = [:]
        newThread = nil
        listedModels = []
        askedNewThread = false
        agentPrefs = nil
        askedAgentPrefs = false
        missing = MissingProjects()
        missingRefetch?.cancel()
        route = nil
        notices.reset()
    }

    private func connect(_ start: RemoteStart) {
        disconnect()
        let next = makeClient(start)
        client = next
        if let key = computer?.key {
            catalogs = saves.models(key)
            newThread = saves.newThread(key).map { ($0.settings, $0.models) }
        }
        readAhead = ReadAhead(cache: offline) { id, saved in try await next.chat(id, previous: saved) }
        if let computer { drafts.device(computer.key, computer.deviceId) }
        showCached()
        tunnels.streams = next.tunnel
        listening = Task { [weak self] in
            for await update in next.updates {
                guard let self, self.client === next else { return }
                self.take(update, from: next)
            }
        }
        Task { await next.start() }
    }

    private func take(_ update: RemoteUpdate, from client: RemoteClient) {
        switch update {
        case .status(let s):
            let cameOnline = s.state == .online && status.state != .online
            status = s
            switch s.state {
            case .offline: failing = true
            case .online, .denied: failing = false
            case .connecting: break
            }
            if cameOnline {
                Task { await refresh(client) }
                backOnline(client)
            }
            if s.state != .online, let active { drafts.offline(active) }
            if s.state != .online { Task { [readAhead] in await readAhead?.want([]) } }
            Task {
                let now = await client.route
                if self.client === client { route = now }
            }
        case .paired(let c), .credentials(let c):
            if let at = computers.firstIndex(where: { $0.key == c.key }) { computers[at] = c }
            store.save(computers, active: active)
        case .event(let event):
            heard(event)
        }
    }

    private func heard(_ event: RemoteEvent) {
        switch event {
        case .chats(let list):
            let before = Dictionary(chats.map { ($0.id, $0.needs) }, uniquingKeysWith: { a, _ in a })
            notices.listed(list)
            chats = list
            cacheSoon()
            lookForMissingProjects()
            if let active, status.state == .online {
                let wanted = ReadAhead.wanted(list, computer: active)
                Task { [readAhead] in await readAhead?.want(wanted) }
            }
            // A request, a question or the queue comes with no message of its own: the list says, the thread is fetched.
            for summary in list where threads[summary.id] != nil && before[summary.id] != summary.needs {
                Task { await load(summary.id) }
            }
        case .presence(let p): present = p
        case .message(let chatId, let message, let title):
            notices.heard(chatId, message)
            guard let held = threads[chatId] else { return }
            var thread = applyMessage(held, message)
            if let title { thread.title = title }
            threads[chatId] = thread
            took(chatId, thread, fetched: 0)
            // What a turn leaves besides its messages (stopped work, moves, the queue) comes with the thread.
            if !message.streaming { Task { await load(chatId) } }
        case .draft(let change):
            if let active { drafts.heard(active, change) }
        case .appearance(let appearance):
            // "Match computer" follows a theme changed there at once.
            overview?.appearance = appearance
        case .handoff: break
        }
    }

    /// After every sign-in: the whole picture again, and the open threads caught up.
    private func refresh(_ client: RemoteClient) async {
        await reloadList(client)
        guard self.client === client else { return }
        for id in threads.keys { await load(id) }
    }

    /// The thread list and projects again, as pulling Home down asks.
    func reloadList() async {
        guard let client else { return }
        await reloadList(client)
    }

    private func reloadList(_ client: RemoteClient) async {
        do {
            try await fetchOverview(client)
        } catch {
            log.error("Couldn't load the overview: \(String(describing: error), privacy: .public)")
        }
    }

    private func fetchOverview(_ client: RemoteClient) async throws {
        let fresh = try await client.overview()
        guard self.client === client else { return }
        overview = fresh
        notices.listed(fresh.chats)
        chats = fresh.chats
        present = fresh.present
        if let active { cache.save(active, fresh) }
        lookForMissingProjects()
        if status.state == .online, let active {
            await drafts.online(active, link: ClientDrafts(client: client), overview: fresh)
        }
    }

    /// A thread in a project the phone hasn't heard of (one just added on the computer, or a
    /// new Scratchpad folder): the projects again a second later, new ids batched into one ask.
    private func lookForMissingProjects() {
        guard let client, let overview, missing.observe(projects: overview.projects, chats: chats) else { return }
        missingRefetch?.cancel()
        missingRefetch = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self, !Task.isCancelled, self.client === client else { return }
            let ids = missing.take()
            do {
                try await fetchOverview(client)
            } catch {
                missing.failed(ids)
            }
        }
    }

    /// Settles, snoozes, wakes or marks a thread; the thread as the desktop left it, for an Undo.
    @discardableResult
    func triage(_ chatId: String, _ action: TriageAction) async throws -> JSON {
        guard let client else { throw PairingError("Not connected to your computer.") }
        let after = try await client.triage(chatId: chatId, action)
        Task { await reloadList(client) }
        return after
    }

    var canMarkUnread: Bool { (overview?.bridge ?? 0) >= Bridge.markedUnread }

    func unread(_ chat: RemoteChatSummary) -> Bool { seen.unread(chat) }

    /// Open on the phone counts as read: here, and on the desktop, which keeps the shared mark.
    /// Past a wake time it reads that too, so "Woke up" clears.
    func markSeen(_ chatId: String, updated: Int64, snoozedUntil: Int64?) {
        if seen.markSeen(chatId, updated: updated) { saveSeen() }
        guard let client, status.state == .online else { return }
        let upTo = openedUpTo(updated, snoozedUntil: snoozedUntil, now: nowMs())
        Task {
            // An older desktop just doesn't know the call.
            do { try await client.markSeen(chatId: chatId, at: upTo) } catch {
                log.debug("Couldn't mark \(chatId, privacy: .public) seen: \(String(describing: error), privacy: .public)")
            }
        }
    }

    private static let seenKey = "relay.thread-seen"

    private static func loadSeen() -> ThreadSeen {
        if let data = UserDefaults.standard.data(forKey: seenKey),
            let saved = try? JSONDecoder().decode(ThreadSeen.self, from: data), saved.since > 0
        {
            return saved
        }
        // The first look: threads older than now aren't news.
        let fresh = ThreadSeen(since: nowMs())
        if let data = try? JSONEncoder().encode(fresh) { UserDefaults.standard.set(data, forKey: seenKey) }
        return fresh
    }

    private func saveSeen() {
        if let data = try? JSONEncoder().encode(seen) { UserDefaults.standard.set(data, forKey: Self.seenKey) }
    }

    /// Fetches a thread, reusing the messages already held.
    func load(_ id: String) async {
        guard let client else { return }
        openSaved(id)
        let fetched = OutboxClock.stamp()
        let asked = threads[id]
        do {
            let chat: RemoteChat
            do {
                chat = try await client.chat(id, previous: asked, history: history[id])
            } catch is MissingMessage {
                chat = try await client.chat(id, history: history[id])
            }
            guard self.client === client else { return }
            // A message the stream moved on while this was asked stays as the stream left it.
            threads[id] = keepNewer(chat, threads[id], asked: asked)
            offline.save(active, id, chat)
            loadErrors[id] = nil
            took(id, threads[id]!, fetched: fetched)
        } catch {
            log.error("Couldn't load thread \(id, privacy: .public): \(String(describing: error), privacy: .public)")
            loadErrors[id] = "Couldn't load this thread: \(error)"
        }
    }

    /// The offline copy, until the thread loads.
    func openSaved(_ id: String) {
        if threads[id] == nil, let saved = offline.now(active, id) { threads[id] = saved }
    }

    /// A page more of the thread's history, up to what the bridge hands out.
    func loadEarlier(_ id: String) async {
        history[id] = min(Bridge.maxRemoteHistory, (history[id] ?? Bridge.remoteHistory) + Bridge.remoteHistory)
        await load(id)
    }

    /// The live client, for a feature's own calls.
    func liveClient() throws -> RemoteClient {
        guard let client else { throw PairingError("Not connected to your computer.") }
        return client
    }

    /// What a conversation's next message goes with unless the composer picks otherwise: what the
    /// thread last sent with, on the agent holding this conversation when that went elsewhere.
    func settings(of chatId: String, rootId: String? = nil) -> ResumeSettings? {
        guard let thread = threads[chatId] else { return nil }
        guard let last = thread.settings else {
            return thread.messages.last(where: { $0.sentSettings != nil })?.sentSettings
        }
        let conversation = self.conversation(chatId, rootId: rootId)
        return conversationSettings(
            last, lastParentId: thread.lastParentId, rootId: rootId, holder: contextAgent(conversation, rootId: rootId))
    }

    /// A side conversation's messages, or the main one's.
    func conversation(_ chatId: String, rootId: String? = nil) -> [ChatMessage] {
        guard let thread = threads[chatId] else { return [] }
        return rootId.map { sideConversation(thread.messages, root: $0) } ?? mainMessages(thread.messages)
    }

    /// Asks the agent's plan limits again; `force` past the desktop's copy.
    func loadUsage(_ provider: String, force: Bool = false) async {
        guard reportsUsage(provider), let client, status.state == .online else { return }
        do {
            let reported = try await client.providerUsage(provider, force: force)
            if self.client === client { usage[provider] = reported }
        } catch {
            log.error("Couldn't read \(provider, privacy: .public)'s usage: \(String(describing: error), privacy: .public)")
        }
    }

    /// Whether the conversation has an answer going: a reply's own, or the thread's.
    func running(_ chatId: String, rootId: String? = nil) -> Bool {
        if let rootId, let thread = threads[chatId] {
            return sideConversation(thread.messages, root: rootId).contains { $0.streaming }
        }
        return chats.first { $0.id == chatId }?.running == true
    }

    /// Queued behind a running answer, or with `steer` into it. `rootId` makes it a reply in that
    /// side conversation; `/btw` on the main one asks beside it, as the desktop's composer does.
    /// `throughDraft` sends it from the computer's composer, which adds what it holds of that draft.
    func send(
        _ text: String, images: [PastedImage] = [], to chatId: String, with picked: ResumeSettings? = nil,
        steer: Bool = false, rootId: String? = nil, sendAt: Int64? = nil, throughDraft: String? = nil,
        id: String = UUID().uuidString.lowercased(), on computer: String? = nil
    ) async throws {
        guard let client, let active else { throw PairingError("Not connected.") }
        guard computer == nil || computer == active else { throw PairingError("The computer changed. Send again on the computer you want.") }
        guard let settings = picked ?? settings(of: chatId, rootId: rootId)
        else { throw PairingError("Pick an agent for this thread first.") }
        let delivery = sendAt != nil || !running(chatId, rootId: rootId) ? nil : steer ? "steer" : "queue"
        let btw = rootId == nil ? text.range(of: "^/btw\\s+", options: [.regularExpression, .caseInsensitive]) : nil
        let send = ProjectChatSend(
            id: id, body: btw.map { String(text[$0.upperBound...]) } ?? text, settings: settings, delivery: delivery,
            images: images, parentId: rootId, side: btw != nil, sendAt: sendAt)
        deliver(send, to: chatId, through: client, computer: active, draft: throughDraft)
    }

    /// Whether a send of this draft goes through the computer, which holds part of it.
    func sendsThroughComputer(_ key: String) -> Bool {
        guard let active, (overview?.bridge ?? 1) >= Bridge.drafts else { return false }
        return drafts.shared(active, key)?.extras?.any == true
    }

    func rename(_ chatId: String, to name: String) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.rename(chatId: chatId, to: name)
        await reloadList(client)
        await load(chatId)
    }

    func regenerateTitle(_ chatId: String) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.regenerateTitle(chatId: chatId)
        await reloadList(client)
    }

    /// `/compact` and the thread menu's; `instructions` say what to keep.
    func compact(_ chatId: String, rootId: String? = nil, instructions: String = "") async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.compact(chatId: chatId, rootId: rootId, instructions: instructions)
        await load(chatId)
    }

    func reloadSession(_ chatId: String) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.reloadSession(chatId: chatId)
    }

    /// The agent's own commands and skills for a project, asked once per connection;
    /// one it couldn't list is asked again the next time the menu opens.
    func commands(_ projectId: String, _ provider: String) async throws -> [ProviderCommand] {
        let key = "\(projectId):\(provider)"
        if let known = commandLists[key] { return known }
        guard let client else { throw PairingError("Not connected.") }
        let list = try await client.projectCommands(projectId: projectId, provider: provider)
        if self.client === client { commandLists[key] = list }
        return list
    }

    var canRegenerateTitle: Bool { (overview?.bridge ?? 0) >= Bridge.title }

    /// Then fetches the thread for the queue as it now stands.
    func queue(_ chatId: String, _ action: QueueAction, messageId: String) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.queueAction(chatId: chatId, action, messageId: messageId)
        await load(chatId)
    }

    /// False means removal could not be confirmed; keep the recovered draft.
    func removeQueuedForEditing(_ chatId: String, messageId: String) async throws -> Bool {
        guard let client else { throw PairingError("Not connected.") }
        let confirmed = try await RelayRemote.removeQueuedForEditing {
            try await client.queueAction(chatId: chatId, .remove, messageId: messageId)
        }
        await load(chatId)
        return confirmed
    }

    func queuedImages(_ chatId: String, item: String) async throws -> [PastedImage] {
        guard let client else { throw PairingError("Not connected.") }
        return try await client.queuedImages(chatId: chatId, itemId: item)
    }

    /// An empty thread in the project, for `send` to give its first message.
    func createThread(in projectId: String, workspace: String?, on computer: String) async throws -> CreatedChat {
        guard let client else { throw PairingError("Not connected.") }
        guard active == computer else { throw PairingError("The computer changed. Send again on the computer you want.") }
        let made = try await client.createProjectChat(projectId: projectId, workspace: workspace)
        guard self.client === client else { throw PairingError("The connection changed. Send again on the computer you want.") }
        return made
    }

    /// Makes the thread, then sends its first message; the thread's id. A retry passes the
    /// failed attempt's `id`, so the computer, which knows the draft's sends by it, starts one thread.
    func start(
        in projectId: String, workspace: String?, _ text: String, images: [PastedImage], with settings: ResumeSettings,
        sendAt: Int64? = nil, throughDraft: String? = nil, id: String = UUID().uuidString.lowercased(), on computer: String? = nil
    ) async throws -> String {
        guard let client, let active else { throw PairingError("Not connected.") }
        guard computer == nil || computer == active else { throw PairingError("The computer changed. Send again on the computer you want.") }
        let send = ProjectChatSend(id: id, body: text, settings: settings, images: images, sendAt: sendAt)
        if let throughDraft {
            return try await client.sendDraft(key: throughDraft, chatId: nil, send)
        }
        let made = try await client.createProjectChat(projectId: projectId, workspace: workspace)
        guard self.client === client else { throw PairingError("The connection changed. Send again on the computer you want.") }
        // One for later goes to the desktop's queue, which the thread shows; through the outbox it
        // would sit there twice. A plain one follows the thread, as a worktree or images can take a while.
        if sendAt != nil {
            try await client.sendProjectChat(chatId: made.id, send)
        } else {
            deliver(send, to: made.id, through: client, computer: active)
        }
        return made.id
    }

    /// A show_html or ask_html page, kept by identity: a saved page never changes.
    /// A page already fetched, so a row mounted again draws it at once.
    func knownPage(_ chatId: String, render: String, page: Int) -> String? {
        pages["\(active ?? ""):\(chatId):\(render):\(page)"]
    }

    func renderPage(_ chatId: String, render: String, page: Int) async throws -> String {
        let key = "\(active ?? ""):\(chatId):\(render):\(page)"
        if let known = pages[key] { return known }
        guard let client else { throw PairingError("Not connected.") }
        let html = try await client.renderPage(chatId: chatId, renderId: render, page: page)
        pages[key] = html
        return html
    }

    var canRender: Bool { (overview?.bridge ?? 1) >= Bridge.render }

    /// Binds a picture read to this connection before its cache schedules the work. `max`
    /// limits its longer side; older computers send it whole.
    func imageRequest(_ source: ImageSource, max: Int?) throws -> @Sendable () async throws -> String {
        if case .attached(_, let imageId) = source, let outgoing = outbox.outgoingImage(imageId) { return { outgoing } }
        guard let client else { throw PairingError("Not connected.") }
        let max = canShrinkImages ? max : nil
        return {
            if let max { return try await client.image(source, max: max) }
            return try await client.wholeImage(source)
        }
    }

    var canShrinkImages: Bool { (overview?.bridge ?? 1) >= Bridge.image }

    /// An unused Scratchpad folder, or a fresh one: where a new Scratchpad chat starts.
    /// Whether the computer tunnels its localhost to the phone's browser.
    var canTunnel: Bool { overview?.tunnels == true }

    /// What runs on the computer's localhost.
    func sites() async throws -> [RemoteSite] {
        guard let client, let computer = active else { throw PairingError("Not connected.") }
        let list = try await client.sites()
        try Task.checkCancellation()
        // A queued answer can outlive both a computer switch and replacement of its client.
        guard self.client === client, active == computer else { throw CancellationError() }
        tunnelPorts.sawSites(list.map(\.port), on: computer)
        return list
    }

    /// Lets the tunnel reach a port someone typed; the computer forgets on restart.
    func tunnelAllow(_ port: Int) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.tunnelAllow(port: port)
    }

    func createScratch() async throws -> String {
        guard let client else { throw PairingError("Not connected.") }
        let projectId = try await client.createScratch()
        guard self.client === client else { throw PairingError("The connection changed. Pick a computer and try again.") }
        return projectId
    }

    /// The active computer's project icons that differ from `known`, and whose they are.
    func projectIcons(known: [String: String?]) async throws -> (computer: String, icons: [String: RemoteProjectIcon]) {
        guard let client, let active else { throw PairingError("Not connected.") }
        return (active, try await client.projectIcons(known: known))
    }

    /// The agent's models, from this connection's list once it has one.
    func models(_ provider: String) async throws -> [AgentModel] {
        if listedModels.contains(provider), let known = catalogs[provider], !known.isEmpty { return known }
        guard let client else { throw PairingError("Not connected.") }
        let list = try await client.agentModels(provider)
        // Empty while the agent's CLI starts: asked again next time.
        if self.client === client, !list.isEmpty {
            catalogs[provider] = list
            listedModels.insert(provider)
            if let active { saves.saveModels(active, catalogs) }
        }
        return list
    }

    func agentDefaults(_ projectId: String, _ provider: String) async throws -> AgentDefaults? {
        guard let client else { throw PairingError("Not connected.") }
        return try await client.agentDefaults(projectId: projectId, provider: provider)
    }

    /// `fresh` asks even when this connection already has them; a failed ask keeps what's known.
    func loadAgentPrefs(fresh: Bool = false) async {
        guard fresh || !askedAgentPrefs, let client, status.state == .online else { return }
        askedAgentPrefs = true
        agentPrefsAsk += 1
        let ask = agentPrefsAsk
        let prefs = try? await client.aiSettings()
        guard self.client === client, ask == agentPrefsAsk else { return }
        if let prefs { agentPrefs = prefs } else if agentPrefs == nil { askedAgentPrefs = false }
    }

    /// The agents a picker offers, keeping `keep` (the composer's own) even when it's off.
    func offeredAgents(keeping keep: String?) -> [String] {
        RelayRemote.offeredAgents(order: agentPrefs?.agentOrder ?? [], off: agentPrefs?.agentsOff ?? [], keep: keep)
    }

    func loadNewThread() async {
        guard !askedNewThread, let client, status.state == .online else { return }
        askedNewThread = true
        let defaults = await client.newThreadDefaults()
        guard self.client === client else { return }
        newThread = defaults
        saveNewThread()
    }

    private func saveNewThread() {
        guard let active, let newThread else { return }
        saves.saveNewThread(active, SavedNewThread(settings: newThread.settings, models: newThread.models))
    }

    /// The next new thread, here or on the computer, opens on what was picked:
    /// the agent, or that agent's model, and the access.
    func rememberNewThread(_ settings: ResumeSettings, over before: ResumeSettings) {
        guard let client, settings != before else { return }
        newThread?.settings = settings
        if settings.provider == before.provider { newThread?.models[settings.provider] = NewThreadModel(settings) }
        saveNewThread()
        Task {
            do {
                if settings.provider != before.provider {
                    try await client.saveNewThreadAgent(settings.provider)
                } else if NewThreadModel(settings) != NewThreadModel(before) {
                    try await client.saveNewThreadModel(settings.provider, NewThreadModel(settings))
                }
                if settings.runtimeMode != before.runtimeMode, canRememberAccess {
                    try await client.saveNewThreadRuntimeMode(settings.runtimeMode)
                }
            } catch {
                log.error("Couldn't remember the new thread's pick: \(String(describing: error), privacy: .public)")
            }
        }
    }

    private var canRememberAccess: Bool { (overview?.bridge ?? 0) >= Bridge.readOnlyMode }

    /// Desktops from before phone dictation don't say, and can't.
    var canDictate: Bool {
        guard let d = overview?.dictation else { return false }
        return d != "unsupported"
    }

    func dictate(_ request: DictationRequest) async throws -> DictationHeard {
        guard let client else { throw PairingError("Not connected to your computer.") }
        return try await client.dictate(request)
    }

    /// Answers what the running turn waits on, then fetches the thread for what comes next.
    func respond(_ chatId: String, request: String, _ response: AgentResponse) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.respond(chatId: chatId, requestId: request, response)
        await load(chatId)
    }

    /// The desktop's message event brings the answered group back.
    func answer(_ chatId: String, message: String, group: String, _ response: AgentResponse) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.answerQuestion(chatId: chatId, messageId: message, groupId: group, response)
    }

    func dismissQuestion(_ chatId: String, message: String, group: String, _ dismissed: Bool) async throws {
        guard let client else { throw PairingError("Not connected.") }
        try await client.setQuestionDismissed(chatId: chatId, messageId: message, groupId: group, dismissed)
    }

    /// A tool call's whole output, which the thread holds cut.
    func activityDetail(_ chatId: String, message: String, activity: String) async throws -> String? {
        guard let client else { throw PairingError("Not connected.") }
        return try await client.activityDetail(chatId: chatId, messageId: message, activityId: activity)
    }

    func stop(_ chatId: String) async throws {
        try await client?.cancelProjectChat(chatId: chatId)
    }

    /// A new thread with the conversation up to this answer; its id.
    func fork(_ chatId: String, from messageId: String) async throws -> String {
        guard let client else { throw PairingError("Not connected.") }
        return try await client.fork(chatId: chatId, messageId: messageId)
    }

    /// Rolls a turn's files back or forward, then fetches the thread for the
    /// files' new marks. Answers the files later edits overlap, which stop it.
    func rewind(_ chatId: String, turn messageId: String, paths: [String]? = nil, mode: String, force: Bool = false)
        async throws -> [String]
    {
        guard let client else { throw PairingError("Not connected.") }
        let conflicts = try await client.rewindTurn(
            chatId: chatId, messageId: messageId, paths: paths, mode: mode, force: force)
        await load(chatId)
        return conflicts
    }

    func diff(_ source: DiffSource) async throws -> RemoteDiff {
        try await liveClient().diff(source)
    }

    var canReadAloud: Bool { overview?.readAloud == true && (overview?.bridge ?? 0) >= Bridge.readAloud }

    func readAloud(_ request: ReadAloudRequest) async throws -> ReadAloudAudio {
        guard let client else { throw PairingError("Not connected to your computer.") }
        return try await client.readAloud(request)
    }

    // MARK: Offline (the rest in ConnectionSends.swift)

    /// The computer's last seen lists while it connects; `present` is only ever the live link's word.
    private func showCached() {
        guard let active, let cached = cache.load(active) else { return }
        overview = cached
        chats = cached.chats
    }

    /// Through the live client, or refusing while there's none.
    var link: OutboxLink { ClientOutboxLink(client) }

    private func backOnline(_ client: RemoteClient) {
        guard let active else { return }
        reached[active] = nowMs()
        ComputerSeen.app.save(reached)
        outbox.resendFailed(ClientOutboxLink(client), computer: active)
        Task { try? await client.reportApp(PhoneAppReport(version: Self.appVersion)) }
    }

    var canUseProjectFolder: Bool { (overview?.bridge ?? 0) >= Bridge.workspace }

    /// The thread's agent works in the project folder from now on, as the desktop's workspace menu can.
    func useProjectFolder(_ chatId: String) async throws {
        guard let client else { throw PairingError("Not connected.") }
        _ = try await client.desktop("selectAgentWorktree", [.string(chatId), nil])
    }

    /// Local network or Tailscale first; the client keeps it with the pairing and moves if it's shorter.
    func setRoutes(_ routes: [RouteKind]) {
        guard let client else { return }
        Task { await client.setRoutes(routes) }
    }
}

private extension RemoteChatSummary {
    /// What changes when a thread starts or stops needing the user, or its queue moves.
    var needs: [String] {
        [running == true, waiting == true, asking == true, blocked == true].map(\.description)
            + [queueMark ?? "", branch ?? "", "\(worktree == true)"]
    }
}

struct PairingError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// The computer's side of the drafts, through the live client.
private struct ClientDrafts: DraftLink {
    let client: RemoteClient

    func save(_ write: DraftWrite) async throws -> SharedDraft? { try await client.saveDraft(write) }
    func other(key: String, drop: Bool) async throws -> SharedDraft? { try await client.draftOther(key: key, drop: drop) }
}
