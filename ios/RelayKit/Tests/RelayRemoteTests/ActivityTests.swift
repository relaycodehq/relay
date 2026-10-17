import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's ChatActivityTest, TriageTest and StartedFamiliesTest.

private func chat(
    _ id: String = "c", updated: Int64 = 5_000, created: Int64 = 1_000, _ fields: [String: JSON] = [:]
) -> RemoteChatSummary {
    var all: [String: JSON] = [
        "id": .string(id), "projectId": "p", "title": .string("Thread \(id)"), "scope": "project",
        "updated": .number(Double(updated)), "created": .number(Double(created)),
    ]
    all.merge(fields) { _, new in new }
    return try! JSON.object(all).decode()
}

private func chat(_ fields: [String: JSON]) -> RemoteChatSummary { chat("c", fields) }

private let prague: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Europe/Prague")!
    return c
}()

private func at(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int = 0) -> Int64 {
    let date = prague.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))!
    return Int64(date.timeIntervalSince1970 * 1000)
}

private func local(_ ms: Int64) -> DateComponents {
    prague.dateComponents([.day, .hour, .weekday], from: Date(timeIntervalSince1970: Double(ms) / 1000))
}

@Test func settledMeansSettledAfterTheLastActivityUnlessWaitingOrSettledMidAnswer() {
    #expect(chatSettled(chat(["settledAt": 6_000])))
    #expect(!chatSettled(chat(["settledAt": 4_000])))
    #expect(!chatSettled(chat(["settledAt": 6_000, "waiting": true])))
    #expect(!chatSettled(chat(["settledAt": 6_000, "running": true])))
    #expect(chatSettled(chat(["settledAt": 4_000, "running": true, "settleWhenDone": 4_000])))
}

@Test func sectionsSplitAndKeepTheLatestFifteenSettledNewestSettleFirst() {
    let settled = (1...20).map { i in chat("s\(i)", updated: 100, ["settledAt": .number(Double(100 + i))]) }
    let snoozed = chat("z", ["snoozedUntil": 10_000])
    let woke = chat("w", ["snoozedUntil": 900])
    let s = chatActivitySections(settled + [snoozed, woke], now: 1_000)
    #expect(s.active.map(\.id) == ["w"])
    #expect(s.snoozed.map(\.id) == ["z"])
    #expect(s.settled.count == 15)
    #expect(s.settled.first?.id == "s20")
}

@Test func inputBlocksOnlyWhenTheTurnStoppedOrTheRequestBlocks() {
    #expect(inputBlocksThread(chat(["waiting": true])))
    #expect(!inputBlocksThread(chat(["waiting": true, "running": true, "asking": true])))
    #expect(inputBlocksThread(chat(["waiting": true, "running": true, "asking": true, "blocked": true])))
    #expect(inputBlocksThread(chat(["waiting": true, "running": true])))
}

@Test func agentsSinceIsTheOldestBackgroundAgent() throws {
    let pending: [ChatPending] = try JSON.parse(
        #"[{"kind":"task","id":"a","since":50,"agent":true},{"kind":"task","id":"b","since":20},"#
            + #"{"kind":"task","id":"c","since":30,"agent":true},{"kind":"wakeup","id":"d","at":10}]"#
    ).decode()
    #expect(agentsSince(pending) == 30)
    #expect(agentsSince(nil) == nil)
}

@Test func presetsDropTheEveningPastFiveAndNextWeekIsAMonday() {
    let clock = Clock(calendar: prague)
    let presets = clock.snoozePresets(at(2026, 9, 22, 10))
    #expect(presets.map(\.id) == ["quarter", "hour", "three-hours", "evening", "tomorrow", "next-week"])
    #expect(local(presets[3].until).hour == 18)
    #expect(local(presets.last!.until).weekday == 2)
    #expect(!clock.snoozePresets(at(2026, 9, 22, 19)).contains { $0.id == "evening" })
}

@Test func aSundaysNextWeekIsPastTomorrow() {
    let clock = Clock(calendar: prague)
    let sunday = Dictionary(uniqueKeysWithValues: clock.snoozePresets(at(2026, 10, 11, 10)).map { ($0.id, local($0.until)) })
    #expect(sunday["tomorrow"]?.day == 12)
    #expect(sunday["next-week"]?.day == 19)
    // A Monday waits for the next one.
    #expect(local(clock.snoozePresets(at(2026, 10, 12, 10)).last!.until).day == 19)
}

@Test func wakeLabelCountsCalendarDaysAcrossDst() {
    let uk = Clock(calendar: prague, locale: Locale(identifier: "en_GB"))
    let us = Clock(calendar: prague, locale: Locale(identifier: "en_US"))
    #expect(!uk.wakeLabel(at(2026, 10, 25, 23, 30), now: at(2026, 10, 25, 10)).hasPrefix("tomorrow"))
    #expect(uk.wakeLabel(at(2027, 3, 29, 0, 30), now: at(2027, 3, 28, 10)).hasPrefix("tomorrow "))
    #expect(uk.wakeLabel(at(2026, 10, 19, 9), now: at(2026, 10, 14, 10)) == "Mon 09:00")
    #expect(us.wakeLabel(at(2026, 10, 30, 9), now: at(2026, 10, 14, 10)).hasPrefix("Oct 30, 9:00"))
}

@Test func labelsForElapsedAndAge() {
    #expect(elapsedLabel(10_000, now: 5_000) == "0s")
    #expect(elapsedLabel(0, now: 59_999) == "59s")
    #expect(elapsedLabel(0, now: 252_000) == "4m 12s")
    #expect(elapsedLabel(0, now: 3_780_000) == "1h 3m")
    #expect(shortAge(0, now: 59_000) == "now")
    #expect(shortAge(0, now: 240_000) == "4m")
    #expect(shortAge(0, now: 3 * 3_600_000) == "3h")
    #expect(shortAge(0, now: 2 * 86_400_000) == "2d")
    #expect(shortAge(0, now: 35 * 86_400_000) == "5w")
}

@Test func readUpToTakesTheFurthestOfFirstLookDeviceAndDesktop() {
    let c = chat(["seenAt": 4_000])
    #expect(ThreadSeen(since: 3_000).movedSinceSeen(c))
    #expect(!ThreadSeen(seen: ["c": 5_000], since: 3_000).movedSinceSeen(c))
    #expect(!ThreadSeen(since: 6_000).movedSinceSeen(c))
}

@Test func groupsByWhatTheFamilyNeeds() {
    let lead = chat("lead")
    let child = chat("kid", ["waiting": true])
    let working = chat("w", ["running": true])
    let idle = chat("i")
    let groups = groupByState([lead, working, idle], started: ["lead": [child]])
    #expect(groups.map(\.label) == ["Needs you", "Running", "Recent"])
    #expect(groups.map { $0.chats.map(\.id) } == [["lead"], ["w"], ["i"]])
}

// MARK: Triage

@Test func undoPutsBackTheSnoozeAndKeepsMarksOnlyTheDesktopSees() throws {
    let before = chat(["snoozedAt": 10, "snoozedUntil": 99, "settledAt": 7, "autoSettled": true])
    let after = try JSON.parse(#"{"id":"c","settledAt":50,"autoSettled":false,"unsettledAt":40,"archivedAt":null}"#)
    let undo = undoTriage(before, after: after)
    // An auto settle isn't a mark to restore.
    #expect(undo == .restore(from: ["settledAt": 50, "unsettledAt": 40], to: ["unsettledAt": 40, "snoozedAt": 10, "snoozedUntil": 99]))
    #expect(
        undo.json
            == ["kind": "restore", "from": ["settledAt": 50, "unsettledAt": 40], "to": ["unsettledAt": 40, "snoozedAt": 10, "snoozedUntil": 99]])
}

@Test func aLiveAutoSettleIsNotAMark() throws {
    #expect(triageState(try JSON.parse(#"{"settledAt":5,"autoSettled":true,"snoozedUntil":9}"#)) == ["snoozedUntil": 9])
}

// MARK: Started families

private func child(_ id: String, _ lead: String, _ created: Int64, _ fields: [String: JSON] = [:]) -> RemoteChatSummary {
    chat(id, created: created, fields.merging(["startedBy": ["chatId": .string(lead), "agent": "claude"]]) { a, _ in a })
}

@Test func childrenSitUnderTheirLeadAskingFirstThenWorkingThenDone() {
    let f = startedFamilies([
        chat("lead"), child("a", "lead", 1), child("b", "lead", 2, ["running": true]),
        child("c", "lead", 3, ["waiting": true]), child("o", "gone", 4),
    ])
    #expect(f.top.map(\.id) == ["lead", "o"])
    #expect(f.started["lead"]?.map(\.id) == ["c", "b", "a"])
    #expect(familyLine(f.started["lead"]!) == "3 threads · 1 working · 1 needs you")
}

@Test func aSettledLeadComesBackAsAHeaderWhereItsFirstChildWas() {
    let f = startedFamilies([chat("x"), child("a", "lead", 1), child("b", "lead", 2)], settled: [chat("lead")])
    #expect(f.top.map(\.id) == ["x", "lead"])
    #expect(f.cards.map(\.id) == ["x"])
    #expect(f.headers == ["lead"])
    #expect(familyLine(f.started["lead"]!) == "2 threads · all done")
}

@Test func foldsKeepTheNewest200AndMoveARetoggledLeadToTheEnd() {
    var folds = FamilyFolds()
    for i in 0..<205 { folds.fold("l\(i)", open: true) }
    #expect(folds.leads.count == 200)
    #expect(folds["l4"] == nil && folds["l5"] == true)
    folds.fold("l5", open: false)
    #expect(folds.leads.last == "l5" && folds["l5"] == false)
}

@Test func sendLaterDropsTheEveningPastFive() {
    let clock = Clock(calendar: prague, locale: Locale(identifier: "en_US"))
    #expect(clock.sendLaterPresets(at(2026, 9, 22, 10))[3].label == "This evening")
    let late = at(2026, 9, 22, 18)
    #expect(clock.sendLaterPresets(late).map(\.label) == ["In 30 minutes", "In 1 hour", "In 3 hours", "Tomorrow morning"])
    #expect(clock.wakeLabel(clock.sendLaterPresets(late).last!.at, now: late).hasPrefix("tomorrow "))
    #expect(modeLabel("auto-accept-edits") == "Auto-accept edits" && modeLabel("odd") == "odd")
}
