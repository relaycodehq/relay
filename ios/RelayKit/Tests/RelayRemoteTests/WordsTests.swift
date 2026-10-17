import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's Words.kt and Times.kt.

@Test func saysHowFastAndHowMuchAnAnswerWrote() throws {
    #expect(formatTokens(812) == "812")
    #expect(formatTokens(4_230) == "4.2k")
    #expect(formatTokens(38_400) == "38k")
    #expect(formatTokens(1_000_000) == "1M")
    #expect(answerSpeed(try JSON.parse(#"{"output":40,"ms":100}"#)) == nil)
    var m = ChatMessage.answer("hi")
    m.streamed = try JSON.parse(#"{"output":3800,"ms":50000}"#)
    m.cost = 0.004
    #expect(answerStats(m) == "3.8k out · 76 tok/s · <$0.01")
    #expect(formatDollars(12) == "$12")
    #expect(formatDollars(1.5) == "$1.50")
}

@Test func leavesOutAReadingTakenDuringTheCompaction() {
    #expect(compactedTokens(281_000, 8_900) == "281k → 8.9k tokens")
    #expect(compactedTokens(281_000, 290_000) == "from 281k tokens")
    #expect(compactedTokens(nil, nil) == "")
}

@Test func namesTheDayAMessageWasSentOn() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Prague")!
    let clock = Clock(calendar: calendar, locale: Locale(identifier: "en_GB"))
    // Thursday 16 October 2025, 13:25 in Prague.
    let now: Int64 = 1_760_613_900_000
    let hour: Int64 = 3_600_000
    #expect(clock.sentLabel(now - hour, now: now) == "12:25")
    #expect(clock.sentLabel(now - 24 * hour, now: now) == "Yesterday 13:25")
    #expect(clock.sentLabel(now - 72 * hour, now: now) == "Monday 13:25")
    // The month as the locale abbreviates it.
    let older = clock.sentLabel(now - 40 * 24 * hour, now: now)
    #expect(older.hasPrefix("6 Sep") && older.hasSuffix(", 13:25"))
}

@Test func groupsATurnsFilesByFolder() {
    let files = ["src/b.ts", "README.md", "src/a.ts", "ios/x.swift"].map {
        TurnFileChange(path: $0, additions: 1, deletions: 0)
    }
    #expect(byFolder(files).map(\.folder) == ["", "ios", "src"])
    #expect(rewindConflictText(["src/a.ts"], mode: "revert") == "a.ts was edited after this turn in ways that overlap it.")
}

extension ChatMessage {
    static func answer(_ body: String) -> ChatMessage {
        try! JSON.parse(
            #"{"id":"m","role":"assistant","body":"\#(body)","status":"complete","created":0,"provider":"claude","version":1}"#
        ).decode()
    }
}

@Test func previewReadsMarkdownAsPlainWords() {
    #expect(preview("## Plan\nDo **this** in [the file](src/a.ts).\n\n```ts\nrun()\n```\n- and `that`") == "Plan: Do this in the file. and that")
    #expect(preview("# Done.\nok") == "Done. ok")
    #expect(preview(String(repeating: "word ", count: 20), length: 12) == "word word w…")
}
