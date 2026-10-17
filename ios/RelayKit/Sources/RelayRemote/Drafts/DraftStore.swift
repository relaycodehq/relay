import Foundation
import Observation

/// How the store reaches the computer while it's online.
public protocol DraftLink: Sendable {
    func save(_ write: DraftWrite) async throws -> SharedDraft?
    func other(key: String, drop: Bool) async throws -> SharedDraft?
}

/// A composer's copy here, and how it stands with the computer's.
public struct DraftCopy: Codable, Sendable, Equatable, LocalDraft {
    public var body: DraftBody
    public var extras: DraftExtras?
    public var synced: Int64?
    public var dirty: Int64?
    /// Sent through the computer, which drops it once it's done; hidden until then.
    public var leaving: Int64?
    /// What a send from here took, until the computer hears it went.
    public var sent: String?

    init(_ body: DraftBody, synced: Int64? = nil, dirty: Int64? = nil, sent: String? = nil) {
        self.body = body
        self.synced = synced
        self.dirty = dirty
        self.sent = sent
    }
}

/// A draft as a list shows it.
public struct ListedDraft: Equatable, Sendable {
    public enum From: Sendable { case here, computer, phone }

    public var key: String
    public var text: String
    /// Where it was started, from this phone's view.
    public var from: From
    public var extras: DraftExtras?
    public var at: Int64
}

/// When something runs later; tests run it on their own clock.
public struct DraftTimers: Sendable {
    public var now: @Sendable () -> Int64
    /// Runs `job` after `ms`; the closure it hands back stops it.
    public var after: @MainActor (_ ms: Int64, _ job: @escaping @MainActor () async -> Void) -> () -> Void

    public init(
        now: @escaping @Sendable () -> Int64,
        after: @escaping @MainActor (Int64, @escaping @MainActor () async -> Void) -> () -> Void
    ) {
        self.now = now
        self.after = after
    }

    public static let live = DraftTimers(
        now: { Int64(Date().timeIntervalSince1970 * 1000) },
        after: { ms, job in
            let task = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(ms))
                if !Task.isCancelled { await job() }
            }
            return { task.cancel() }
        })
}

/// mobile/src/remote/drafts.ts and the Kotlin app's DraftStore: unsent composer text per
/// computer and composer, kept on the phone and shared with the computer from
/// `Bridge.drafts` on. Typing goes on offline and goes once the computer is back.
@MainActor
@Observable
public final class DraftStore {
    /// Bumped on every change; lists read after it.
    public private(set) var version = 0
    /// Bumped per `computer\nkey` when a draft's text changed under its composer.
    private var keyChanges: [String: Int] = [:]

    @ObservationIgnored private let dir: URL?
    @ObservationIgnored private let timers: DraftTimers
    @ObservationIgnored private var copies: [String: [String: DraftCopy]] = [:]
    @ObservationIgnored private var theirs: [String: [String: SharedDraft]] = [:]
    @ObservationIgnored private var slots: [String: [String: String]] = [:]
    @ObservationIgnored private var devices: [String: String] = [:]
    @ObservationIgnored private var loaded: Set<String> = []
    @ObservationIgnored private var link: (computer: String, link: any DraftLink)?
    @ObservationIgnored private var held: Set<String> = []
    @ObservationIgnored private var pushing: Set<String> = []
    @ObservationIgnored private var pushTimers: [String: () -> Void] = [:]
    @ObservationIgnored private var saveTimers: [String: () -> Void] = [:]
    @ObservationIgnored private var running: [UUID: Task<Void, Never>] = [:]

    /// The pause after typing before an edit goes.
    public static let pause: Int64 = 400
    /// A send through the computer has this long before its copy shows again.
    public static let leavingFor: Int64 = 120_000

    public init(dir: URL?, timers: DraftTimers = .live) {
        self.dir = dir
        self.timers = timers
    }

    private func id(_ computer: String, _ key: String) -> String { "\(computer)\n\(key)" }
    private func now() -> Int64 { timers.now() }
    private func leaving(_ copy: DraftCopy) -> Bool { copy.leaving.map { now() - $0 < Self.leavingFor } ?? false }

    private func notifyKey(_ computer: String, _ key: String) { keyChanges[id(computer, key), default: 0] += 1 }

    private func changed(_ computer: String, _ key: String? = nil) {
        version += 1
        if let key { notifyKey(computer, key) }
        persist(computer)
    }

    /// Counts the times the draft changed under its composer; watch it to take the new text.
    public func changes(_ computer: String, _ key: String) -> Int { keyChanges[id(computer, key)] ?? 0 }

    private func launch(_ work: @escaping @MainActor () async -> Void) {
        let token = UUID()
        running[token] = Task { @MainActor in
            await work()
            running[token] = nil
        }
    }

    /// Waits for the pushes started so far; for tests.
    public func settled() async {
        while let task = running.values.first { await task.value }
    }

    // MARK: Disk

    private struct Saved: Codable {
        var copies: [String: DraftCopy] = [:]
        var theirs: [SharedDraft] = []
        /// Each project's new thread being written here.
        var slots: [String: String] = [:]
        var device: String?
    }

    private func file(_ computer: String) -> URL? {
        dir?.appendingPathComponent(
            computer.utf8.reduce(into: "") { $0 += String(format: "%02x", $1) } + ".json")
    }

    /// Reads the computer's drafts kept here, once.
    public func load(_ computer: String) {
        guard loaded.insert(computer).inserted else { return }
        if let file = file(computer), let data = try? Data(contentsOf: file),
            let saved = try? JSONDecoder().decode(Saved.self, from: data)
        {
            var map = copies[computer] ?? [:]
            for (key, copy) in saved.copies where map[key] == nil { map[key] = copy }
            copies[computer] = map
            for draft in saved.theirs { theirs[computer, default: [:]][draft.key] = draft }
            slots[computer] = saved.slots.merging(slots[computer] ?? [:]) { _, here in here }
            if let device = saved.device, devices[computer] == nil { devices[computer] = device }
        }
        changed(computer)
    }

    private func persist(_ computer: String) {
        guard let file = file(computer) else { return }
        saveTimers[computer]?()
        saveTimers[computer] = timers.after(300) { [weak self] in
            guard let self else { return }
            saveTimers[computer] = nil
            let saved = Saved(
                copies: copies[computer] ?? [:], theirs: Array((theirs[computer] ?? [:]).values),
                slots: slots[computer] ?? [:], device: devices[computer])
            guard let data = try? JSONEncoder().encode(saved) else { return }
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    // MARK: The computer

    /// Whether a draft's writer is this phone.
    public func isThisPhone(_ computer: String, _ device: String) -> Bool {
        devices[computer].map { device == phoneDevice($0) } ?? false
    }

    /// Which phone this is to the computer, to tell its own drafts from another phone's.
    public func device(_ computer: String, _ deviceId: String) {
        devices[computer] = deviceId
        load(computer)
    }

    /// Online with a fresh overview: lines the drafts here up with the computer's.
    public func online(_ computer: String, link to: any DraftLink, overview: RemoteOverview) async {
        load(computer)
        guard (overview.bridge ?? 1) >= Bridge.drafts, let drafts = overview.drafts else {
            // A computer from before sharing: drafts stay here.
            if link?.computer == computer { link = nil }
            return
        }
        link = (computer, to)
        var map = copies[computer] ?? [:]
        theirs[computer] = Dictionary(drafts.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
        let local = map.filter { isShareableDraftKey($0.key) && !leaving($0.value) }.map { (key: $0.key, draft: $0.value as any LocalDraft) }
        let plan = reconcileDrafts(local, drafts)
        for draft in plan.take {
            if let copy = map[draft.key], leaving(copy) { continue }
            map[draft.key] = DraftCopy(draft.body, synced: draft.rev)
            notifyKey(computer, draft.key)
        }
        for key in plan.drop {
            map[key] = nil
            notifyKey(computer, key)
        }
        // Gone from the computer meanwhile: a send through it is done.
        let there = theirs[computer] ?? [:]
        map = map.filter { $0.value.leaving == nil || there[$0.key] != nil }
        copies[computer] = map
        changed(computer)
        for key in plan.push { await push(computer, key) }
    }

    public func offline(_ computer: String) {
        if link?.computer == computer { link = nil }
    }

    /// A draft changed on the computer, or on another phone.
    public func heard(_ computer: String, _ change: DraftChange) {
        let key = change.key
        theirs[computer, default: [:]][key] = change.draft
        let copy = copies[computer]?[key]
        let busy = copy?.dirty != nil || held.contains(id(computer, key)) || pushing.contains(id(computer, key))
        if busy || (copy.map(leaving) == true && change.draft != nil) { return changed(computer) }
        if let draft = change.draft {
            if copy == nil || copy?.synced != draft.rev { copies[computer, default: [:]][key] = DraftCopy(draft.body, synced: draft.rev) }
        } else {
            copies[computer]?[key] = nil
        }
        changed(computer, key)
    }

    // MARK: Editing

    /// An edit here: kept at once, sent a pause later. Ignored while a send holds the composer.
    public func edit(_ computer: String, _ key: String, _ change: (DraftBody) -> DraftBody) {
        guard !held.contains(id(computer, key)) else { return }
        let copy = copies[computer]?[key]
        // One on its way out shows as empty; only something new typed replaces it.
        let shown = copy.flatMap { leaving($0) ? nil : $0.body } ?? DraftBody(text: "")
        let body = change(shown).normal
        if copy != nil && shown.same(as: body) { return }
        if copy == nil && body.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        var next = copy ?? DraftCopy(body)
        next.body = body
        next.dirty = now()
        next.leaving = nil
        next.sent = nil
        copies[computer, default: [:]][key] = next
        changed(computer)
        schedule(computer, key)
    }

    public func editText(_ computer: String, _ key: String, _ text: String) {
        edit(computer, key) { var body = $0; body.text = text; return body }
    }

    private func schedule(_ computer: String, _ key: String) {
        guard isShareableDraftKey(key) else { return }
        let at = id(computer, key)
        pushTimers[at]?()
        pushTimers[at] = timers.after(Self.pause) { [weak self] in
            self?.pushTimers[at] = nil
            await self?.push(computer, key)
        }
    }

    private func push(_ computer: String, _ key: String) async {
        let at = id(computer, key)
        // Offline it stays edited, and goes once the computer is back.
        guard let to = link, to.computer == computer, let copy = copies[computer]?[key], let editedAt = copy.dirty,
            !held.contains(at)
        else { return }
        if pushing.contains(at) { return schedule(computer, key) }
        pushing.insert(at)
        defer { pushing.remove(at) }
        let write = DraftWrite(key: key, base: copy.synced ?? 0, at: editedAt, body: copy.body.normal, sent: copy.sent)
        let after: SharedDraft?
        do {
            after = try await to.link.save(write)
        } catch {
            // Still edited: the next edit or reconnect sends it.
            return
        }
        settle(computer, key, after, editedAt: editedAt)
    }

    /// The computer took a write: `after` is how the draft stands now.
    private func settle(_ computer: String, _ key: String, _ after: SharedDraft?, editedAt: Int64) {
        theirs[computer, default: [:]][key] = after
        guard var copy = copies[computer]?[key] else { return changed(computer) }
        // Typed again meanwhile: the next push goes from this version.
        if copy.dirty != editedAt {
            copy.synced = after?.rev ?? copy.synced
            copies[computer]?[key] = copy
            schedule(computer, key)
            return changed(computer)
        }
        guard let after else {
            copies[computer]?[key] = nil
            return changed(computer, key)
        }
        let lost = !copy.body.same(as: after.body)
        copies[computer]?[key] = DraftCopy(after.body, synced: after.rev)
        changed(computer, lost ? key : nil)
    }

    // MARK: Sending

    /// A send is taking the composer's text: edits wait until it went or came back.
    public func hold(_ computer: String, _ key: String) { held.insert(id(computer, key)) }

    /// The send came back: the composer has its text again.
    public func release(_ computer: String, _ key: String) { held.remove(id(computer, key)) }

    /// The send went. Through the computer, it drops the draft itself once done; otherwise
    /// this tells it the text went, so what was typed there since stays.
    public func went(_ computer: String, _ key: String, text: String, throughComputer: Bool) {
        held.remove(id(computer, key))
        // The next new thread in its project starts a draft of its own.
        if let own = slots[computer], own.values.contains(key) { slots[computer] = own.filter { $0.value != key } }
        guard var copy = copies[computer]?[key] else { return }
        if throughComputer {
            copy.leaving = now()
            copies[computer]?[key] = copy
            return changed(computer)
        }
        if !isShareableDraftKey(key) || (copy.synced == nil && link?.computer != computer) {
            copies[computer]?[key] = nil
        } else {
            copies[computer]?[key] = DraftCopy(DraftBody(text: ""), synced: copy.synced, dirty: now(), sent: text)
            launch { [weak self] in await self?.push(computer, key) }
        }
        changed(computer, key)
    }

    /// Swaps in the version a clash kept, or with `drop` lets it go.
    public func resolveOther(_ computer: String, _ key: String, drop: Bool) async throws {
        guard let to = link, to.computer == computer else { throw RemoteCallError.notConnected("Wait for your computer to come back.") }
        pushTimers.removeValue(forKey: id(computer, key))?()
        await push(computer, key)
        if let after = try await to.link.other(key: key, drop: drop) {
            theirs[computer, default: [:]][key] = after
            copies[computer, default: [:]][key] = DraftCopy(after.body, synced: after.rev)
        }
        changed(computer, key)
    }

    // MARK: New threads

    /// The key a project's new thread is written under here, a fresh one once the last went.
    public func newThreadKey(_ computer: String, _ projectId: String) -> String {
        if let key = slots[computer]?[projectId] { return key }
        let key = "new:\(projectId):\(String(now(), radix: 36))"
        slots[computer, default: [:]][projectId] = key
        persist(computer)
        return key
    }

    /// Opens this one for its project: a new thread's draft picked from the list, maybe started
    /// on the computer, is the one written from now on.
    public func pickNewThread(_ computer: String, _ projectId: String, key: String) {
        slots[computer, default: [:]][projectId] = key
        persist(computer)
    }

    /// What's typed follows the new thread to another project.
    public func move(_ computer: String, from: String, to: String) {
        guard let copy = copies[computer]?[from] else { return }
        let typed = copy.body.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty else { return }
        let there = copies[computer]?[to]?.body.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        edit(computer, to) { _ in
            var body = copy.body
            if !there.isEmpty && there != typed { body.text = "\(there)\n\n\(typed)" }
            return body
        }
        editText(computer, from, "")
        notifyKey(computer, to)
    }

    // MARK: Reading

    /// What the composer shows; nothing for one on its way out through the computer.
    public func text(_ computer: String, _ key: String) -> String {
        guard let copy = copies[computer]?[key], !leaving(copy) else { return "" }
        return copy.body.text
    }

    /// Where a new thread's draft will work, as picked here or on the computer.
    public func workspace(_ computer: String, _ key: String) -> String? {
        _ = version
        return copies[computer]?[key]?.body.workspace ?? theirs[computer]?[key]?.workspace
    }

    /// The computer's copy of a draft: where it started, what it holds there, a version a clash kept.
    public func shared(_ computer: String, _ key: String) -> SharedDraft? {
        _ = version
        return theirs[computer]?[key]
    }

    /// Every draft of the computer's worth listing, by key.
    public func listed(_ computer: String?) -> [String: ListedDraft] {
        _ = version
        guard let computer else { return [:] }
        let me = devices[computer].map(phoneDevice)
        let there = theirs[computer] ?? [:]
        var drafts: [String: ListedDraft] = [:]
        for (key, copy) in copies[computer] ?? [:] where isShareableDraftKey(key) && !leaving(copy) {
            let draft = there[key]
            guard !copy.body.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft?.extras?.any == true
            else { continue }
            let origin = draft?.origin
            let from: ListedDraft.From = origin == nil || origin == me ? .here : origin == "desktop" ? .computer : .phone
            drafts[key] = ListedDraft(
                key: key, text: copy.body.text, from: from, extras: draft?.extras, at: copy.dirty ?? draft?.at ?? 0)
        }
        return drafts
    }

    /// A computer forgotten takes its drafts here with it.
    public func forget(_ computer: String) {
        copies[computer] = nil
        theirs[computer] = nil
        slots[computer] = nil
        devices[computer] = nil
        loaded.remove(computer)
        if link?.computer == computer { link = nil }
        saveTimers.removeValue(forKey: computer)?()
        if let file = file(computer) { try? FileManager.default.removeItem(at: file) }
        version += 1
    }
}

/// The draft a thread's row shows: its main conversation's, else a side one's.
public func threadDraft(_ drafts: [String: ListedDraft], chatId: String) -> ListedDraft? {
    drafts[chatId] ?? drafts.first { $0.key.hasPrefix("\(chatId):") }?.value
}
