import Foundation
import Testing

@testable import RelayRemote

/// The test's own clock: timers run when it's moved past them.
@MainActor
private final class FakeClock {
    nonisolated(unsafe) var time: Int64 = 1_000
    private var jobs: [(at: Int64, id: Int, job: @MainActor () async -> Void)] = []
    private var next = 0

    var timers: DraftTimers {
        DraftTimers(now: { [unowned self] in time }) { [unowned self] ms, job in
            next += 1
            let id = next
            jobs.append((time + ms, id, job))
            return { [weak self] in self?.jobs.removeAll { $0.id == id } }
        }
    }

    func advance(_ ms: Int64) async {
        let until = time + ms
        while let due = jobs.filter({ $0.at <= until }).min(by: { $0.at < $1.at }) {
            jobs.removeAll { $0.id == due.id }
            time = due.at
            await due.job()
        }
        time = until
    }
}

private final class Heard: @unchecked Sendable {
    var count = 0
}

/// A computer that merges as shared/drafts' applyDraftWrite does.
@MainActor
private final class Computer: DraftLink, @unchecked Sendable {
    var main: [String: SharedDraft] = [:]
    var rev: Int64 = 0
    var saves: [DraftWrite] = []
    var offline = false

    func apply(_ write: DraftWrite, by: String) {
        let current = main[write.key]
        let stale = current.map { write.base < $0.rev } ?? false
        func make(_ text: String, _ other: DraftOther?, at: Int64 = write.at, who: String = by) {
            if text.trimmingCharacters(in: .whitespaces).isEmpty {
                main[write.key] = nil
                return
            }
            if let current, current.text == text, current.other == other { return }
            rev += 1
            main[write.key] = SharedDraft(
                key: write.key, rev: rev, at: at, by: who, origin: current?.origin ?? by, text: text, other: other)
        }
        if let sent = write.sent, !stale {
            make("", nil)
        } else if let sent = write.sent, let current {
            let now = current.text.trimmingCharacters(in: .whitespaces)
            make(
                now.hasPrefix(sent) ? String(now.dropFirst(sent.count)).trimmingCharacters(in: .whitespaces) : current.text,
                nil, at: current.at)
        } else if !stale {
            make(write.text, current?.other)
        } else if let current, current.text == write.text || write.text.trimmingCharacters(in: .whitespaces).isEmpty {
            make(current.text, current.other, at: current.at, who: current.by)
        } else if let current, write.at >= current.at {
            make(write.text, DraftOther(text: current.text, by: current.by, at: current.at))
        } else if let current {
            make(current.text, DraftOther(text: write.text, by: by, at: write.at), at: current.at, who: current.by)
        }
    }

    nonisolated func save(_ write: DraftWrite) async throws -> SharedDraft? {
        try await MainActor.run {
            if offline { throw RemoteCallError.notConnected("Not connected") }
            saves.append(write)
            apply(write, by: "phone:me")
            return main[write.key]
        }
    }

    nonisolated func other(key: String, drop: Bool) async throws -> SharedDraft? {
        await MainActor.run { main[key] }
    }

    func overview(bridge: Int = 19) -> RemoteOverview {
        try! JSON.object(["name": "Studio", "bridge": .number(Double(bridge)), "projects": [], "chats": []]).decode(
            RemoteOverview.self
        ).with(drafts: Array(main.values))
    }

    @discardableResult
    func desktop(_ key: String, _ text: String, at: Int64) -> SharedDraft {
        apply(DraftWrite(key: key, base: main[key]?.rev ?? 0, at: at, body: DraftBody(text: text)), by: "desktop")
        return main[key]!
    }
}

extension RemoteOverview {
    fileprivate func with(drafts: [SharedDraft]) -> RemoteOverview {
        var copy = self
        copy.drafts = drafts
        return copy
    }
}

@MainActor
struct DraftStoreTests {
    private let pc = "computer-1"
    private let chat = "chat-1"
    private let clock = FakeClock()
    private let computer = Computer()

    private func store() -> DraftStore {
        let drafts = DraftStore(dir: nil, timers: clock.timers)
        drafts.device(pc, "me")
        return drafts
    }

    @Test func listsHearOfTypingOnceItPausesNotWithEveryLetter() async {
        let drafts = store()
        drafts.editText(pc, chat, "H", typing: true)
        let heard = Heard()
        withObservationTracking { _ = drafts.listed(pc) } onChange: { heard.count += 1 }
        for text in ["He", "Hel", "Hell", "Hello"] { drafts.editText(pc, chat, text, typing: true) }
        #expect(heard.count == 0)
        #expect(drafts.listed(pc)[chat]?.text == "Hello")
        await clock.advance(DraftStore.listPause)
        #expect(heard.count == 1)
    }

    @Test func keepsWhatsTypedOfflineAndSendsItOnceTheComputerIsBack() async {
        let drafts = store()
        drafts.editText(pc, chat, "On the train")
        await clock.advance(450)
        #expect(computer.saves.isEmpty)
        await drafts.online(pc, link: computer, overview: computer.overview())
        #expect(computer.main[chat]?.text == "On the train")
        #expect(computer.main[chat]?.origin == "phone:me")
    }

    @Test func takesTheComputersDraftsAndDropsTheOnesGoneThere() async {
        let drafts = store()
        await drafts.online(pc, link: computer, overview: computer.overview())
        drafts.editText(pc, "gone", "Sent from the computer later")
        await clock.advance(450)
        computer.main["gone"] = nil
        computer.desktop(chat, "Started on the computer", at: clock.time)
        drafts.offline(pc)
        await drafts.online(pc, link: computer, overview: computer.overview())
        #expect(drafts.text(pc, chat) == "Started on the computer")
        #expect(drafts.text(pc, "gone") == "")
        #expect(drafts.listed(pc)[chat]?.from == .computer)
    }

    @Test func theLaterEditWinsAfterEditingOfflineTheOtherATapAway() async {
        let drafts = store()
        await drafts.online(pc, link: computer, overview: computer.overview())
        drafts.editText(pc, chat, "first")
        await clock.advance(450)
        drafts.offline(pc)
        computer.offline = true
        drafts.editText(pc, chat, "edited on the phone, offline")
        computer.desktop(chat, "edited on the computer", at: clock.time + 1000)
        computer.offline = false
        await drafts.online(pc, link: computer, overview: computer.overview())
        #expect(computer.main[chat]?.text == "edited on the computer")
        #expect(computer.main[chat]?.other?.text == "edited on the phone, offline")
        #expect(drafts.text(pc, chat) == "edited on the computer")
    }

    @Test func whatsBeingTypedBeatsTheComputersChangeOtherwiseItsTaken() async {
        let drafts = store()
        await drafts.online(pc, link: computer, overview: computer.overview())
        drafts.editText(pc, chat, "typing")
        let before = drafts.changes(pc, chat)
        drafts.heard(pc, DraftChange(key: chat, draft: computer.desktop(chat, "from the computer", at: clock.time)))
        #expect(drafts.text(pc, chat) == "typing")
        #expect(drafts.changes(pc, chat) == before)
        drafts.heard(pc, DraftChange(key: "other", draft: computer.desktop("other", "from the computer", at: clock.time)))
        #expect(drafts.text(pc, "other") == "from the computer")
        #expect(drafts.changes(pc, "other") == 1)
    }

    @Test func tellsTheComputerWhatASendFromHereTook() async {
        let drafts = store()
        await drafts.online(pc, link: computer, overview: computer.overview())
        drafts.editText(pc, chat, "Ship it")
        await clock.advance(450)
        drafts.hold(pc, chat)
        drafts.editText(pc, chat, "")
        drafts.went(pc, chat, text: "Ship it", throughComputer: false)
        await drafts.settled()
        #expect(computer.saves.last?.text == "")
        #expect(computer.saves.last?.sent == "Ship it")
        #expect(computer.main[chat] == nil)
    }

    @Test func keepsTheNextMessageTypedWhileASendWasGoingOut() async {
        let drafts = store()
        await drafts.online(pc, link: computer, overview: computer.overview())
        drafts.editText(pc, chat, "Ship it")
        await clock.advance(450)
        drafts.hold(pc, chat)
        // Typed during the send: the held draft ignores it, as the composer's edits are.
        drafts.editText(pc, chat, "And the docs")
        drafts.went(pc, chat, text: "Ship it", throughComputer: false)
        // What the composer does once the send settles.
        drafts.editText(pc, chat, "And the docs")
        #expect(drafts.text(pc, chat) == "And the docs")
        await drafts.settled()
        await clock.advance(450)
        #expect(computer.main[chat]?.text == "And the docs")
        #expect(drafts.text(pc, chat) == "And the docs")
    }

    @Test func hidesADraftSentThroughTheComputerUntilItDropsIt() async {
        let drafts = store()
        await drafts.online(pc, link: computer, overview: computer.overview())
        drafts.heard(pc, DraftChange(key: chat, draft: computer.desktop(chat, "With a screenshot", at: clock.time)))
        drafts.hold(pc, chat)
        drafts.went(pc, chat, text: "With a screenshot", throughComputer: true)
        #expect(drafts.listed(pc)[chat] == nil)
        #expect(drafts.text(pc, chat) == "")
        drafts.editText(pc, chat, "")
        await clock.advance(450)
        #expect(computer.saves.isEmpty)
        drafts.heard(pc, DraftChange(key: chat, draft: computer.desktop(chat, "With a screenshot!", at: clock.time)))
        #expect(drafts.listed(pc)[chat] == nil)
        drafts.heard(pc, DraftChange(key: chat, draft: nil, sent: true))
        #expect(drafts.text(pc, chat) == "")
    }

    @Test func keepsDraftsOnThePhoneWithAComputerFromBeforeSharing() async {
        let drafts = store()
        drafts.editText(pc, chat, "Local")
        await drafts.online(pc, link: computer, overview: computer.overview(bridge: 18))
        await clock.advance(450)
        #expect(computer.saves.isEmpty)
        #expect(drafts.text(pc, chat) == "Local")
    }

    @Test func startsAFreshNewThreadDraftPerProjectOnceTheLastOneWent() async {
        let drafts = store()
        let first = drafts.newThreadKey(pc, "p1")
        #expect(first == drafts.newThreadKey(pc, "p1"))
        #expect(first.range(of: "^new:p1:[a-z0-9]+$", options: .regularExpression) != nil)
        #expect(isShareableDraftKey(first))
        drafts.editText(pc, first, "Build it")
        drafts.hold(pc, first)
        drafts.went(pc, first, text: "Build it", throughComputer: false)
        await clock.advance(5)
        #expect(first != drafts.newThreadKey(pc, "p1"))
    }

    @Test func aNewThreadDraftPickedFromTheListIsWrittenOnWithItsWorkspace() async {
        let drafts = store()
        let started = "new:p1:abc"
        var draft = computer.desktop(started, "Started on the computer", at: clock.time)
        draft.workspace = "worktree"
        computer.main[started] = draft
        await drafts.online(pc, link: computer, overview: computer.overview())
        #expect(newDraftProject(started) == "p1")
        #expect(newDraftProject("chat-1") == nil)
        #expect(drafts.workspace(pc, started) == "worktree")
        drafts.pickNewThread(pc, "p1", key: started)
        #expect(drafts.newThreadKey(pc, "p1") == started)
        drafts.edit(pc, started) { var body = $0; body.workspace = "checkout"; return body }
        #expect(drafts.workspace(pc, started) == "checkout")
        await clock.advance(450)
        #expect(computer.saves.last?.workspace == "checkout")
    }

    @Test func keepsDraftsOnDiskAcrossLaunches() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let first = DraftStore(dir: dir, timers: clock.timers)
        first.editText(pc, chat, "Half a thought")
        await clock.advance(350)
        let again = DraftStore(dir: dir, timers: clock.timers)
        again.load(pc)
        #expect(again.text(pc, chat) == "Half a thought")
    }

    @Test func summarizesWhatStaysOnTheComputer() {
        #expect(
            extrasSummary(DraftExtras(screenshots: [1, 2], codeRefs: 1, selection: true))
                == "2 screenshots, a code reference and a selected line")
        #expect(extrasSummary(DraftExtras()) == "")
        #expect(!DraftExtras().any)
    }
}
