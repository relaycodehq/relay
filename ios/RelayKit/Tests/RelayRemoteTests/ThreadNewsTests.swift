import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's ThreadNewsTest (shared/thread-news.test.ts).

private func chat(_ id: String, updated: Int64 = 10, _ fields: [String: JSON] = [:]) -> RemoteChatSummary {
    var all: [String: JSON] = [
        "id": .string(id), "projectId": "p", "title": .string("Thread \(id)"), "scope": "project",
        "updated": .number(Double(updated)), "created": 1, "provider": "claude",
    ]
    all.merge(fields) { _, new in new }
    return try! JSON.object(all).decode()
}

private func list(_ chats: RemoteChatSummary...) -> [String: RemoteChatSummary] {
    Dictionary(uniqueKeysWithValues: chats.map { ($0.id, $0) })
}

private func answer(_ status: String = "complete", body: String = "", error: String? = nil) -> LastAnswer {
    LastAnswer(status: status, body: body, error: error, provider: "claude")
}

private let running: [String: JSON] = ["running": true]

struct ThreadNewsTests {
    @Test func keepsQuietAboutACompactionThatRanWhileYouWereAway() {
        let answers = ["a": answer(body: "The answer before it")]
        #expect(threadNews(before: list(chat("a", running)), now: [chat("a")], answers: answers, at: 0).isEmpty)
        let started = list(chat("a", ["running": true, "runningSince": 15]))
        #expect(threadNews(before: started, now: [chat("a")], answers: answers, at: 0).isEmpty)
    }

    @Test func keepsAReviewersFinishedReportQuietButTellsOfItsFailure() {
        let reviewer: [String: JSON] = ["reviewer": true]
        let ran: [String: JSON] = ["reviewer": true, "running": true]
        let news = threadNews(
            before: list(chat("a", ran), chat("b", ran)), now: [chat("a", updated: 20, reviewer), chat("b", updated: 20, reviewer)],
            answers: ["a": answer(body: "Found two bugs"), "b": answer("failed", error: "Claude's login expired.")], at: 0)
        #expect(news == [ThreadNews("b", .failed, "Thread b", "Claude's login expired.")])
    }

    @Test func tellsOfAnAnswerWhoseEndWasListedWhileTheThreadStillRan() {
        let news = threadNews(
            before: list(chat("a", updated: 20, ["running": true, "runningSince": 15])), now: [chat("a", updated: 20)],
            answers: ["a": answer(body: "Done")], at: 0)
        #expect(news == [ThreadNews("a", .finished, "Thread a", "Done")])
    }

    @Test func tellsOfAFinishedAnswerByItsFirstWordsAndAFailedOneByItsError() {
        let news = threadNews(
            before: list(chat("a", running), chat("b", running), chat("c", running)),
            now: [chat("a", updated: 20), chat("b", updated: 20), chat("c", updated: 20)],
            answers: [
                "a": answer(body: "## Done\n\nFixed **the** [race](src/x.ts) in `turn-run.ts`."),
                "b": answer("failed", error: "Claude's login expired."),
                "c": answer(
                    "failed",
                    error:
                        "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}"
                ),
            ], at: 0)
        #expect(
            news == [
                ThreadNews("a", .finished, "Thread a", "Done: Fixed the race in turn-run.ts."),
                ThreadNews("b", .failed, "Thread b", "Claude's login expired."),
                ThreadNews("c", .failed, "Thread c", "Overloaded"),
            ])
    }

    @Test func tellsOfAQuestionAtOnceEvenWhileTheAgentStillRuns() {
        let news = threadNews(
            before: list(chat("a", running)), now: [chat("a", ["running": true, "waiting": true, "asking": true])],
            answers: [:], at: 0)
        #expect(news == [ThreadNews("a", .waiting, "Thread a", "Claude needs you")])
    }

    @Test func staysQuietAboutNewStoppedSnoozedAndReadThreads() {
        let news = threadNews(
            before: list(chat("stopped", running), chat("snoozed", running), chat("watched", running)),
            now: [
                chat("new", ["waiting": true]), chat("stopped"), chat("snoozed", ["snoozedUntil": 5_000]),
                chat("watched", updated: 20, ["seenAt": 20]),
            ],
            answers: ["stopped": answer("cancelled")], at: 1_000)
        #expect(news.isEmpty)
    }

    @Test func quietForThreadsSettledWhileRunningButTellsOfOneThatWokeUp() {
        let whileRunning: [String: JSON] = ["settledAt": 15, "settleWhenDone": 15]
        let news = threadNews(
            before: list(
                chat("settling", running.merging(whileRunning) { a, _ in a }),
                chat("settled", running.merging(whileRunning) { a, _ in a }),
                chat("failed", running.merging(whileRunning) { a, _ in a }),
                chat("woke", ["running": true, "settledAt": 5])),
            now: [
                chat("settling", updated: 20, whileRunning), chat("settled", updated: 20, ["settledAt": 21]),
                chat("failed", updated: 20, whileRunning), chat("woke", updated: 20, ["settledAt": 5]),
            ],
            answers: ["failed": answer("failed", error: "Boom.")], at: 0)
        #expect(news.map(\.chatId) == ["failed", "woke"])
        #expect(news.map(\.kind) == [.failed, .finished])
    }

    @Test func stillReportsAFailedTurnWhileAnEarlierQuestionRemainsOpen() {
        let news = threadNews(
            before: list(chat("a", ["running": true, "waiting": true, "asking": true])),
            now: [chat("a", updated: 20, ["waiting": true, "asking": true])],
            answers: ["a": answer("failed", error: "API Error: 529 {\"error\":{\"message\":\"Overloaded\"}}")], at: 0)
        #expect(news == [ThreadNews("a", .failed, "Thread a", "Overloaded")])
    }

    @Test func tellsOfAUsageLimitWithItsResumeTime() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Prague")!
        func ms(_ day: Int, _ hour: Int) -> Int64 {
            Int64(calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour))!.timeIntervalSince1970 * 1000)
        }
        let news = threadNews(
            before: list(chat("a", running)),
            now: [chat("a", ["running": true, "limitResume": ["messageId": "m", "provider": "codex", "at": .number(Double(ms(15, 9)))]])],
            answers: [:], at: ms(14, 10), clock: Clock(calendar: calendar, locale: Locale(identifier: "en_US")))
        #expect(news.first?.kind == .failed)
        #expect(news.first?.body.hasPrefix("Codex hit its usage limit · resumes the answer at tomorrow ") == true)
    }

    @Test func clearsANoticeOnceTheThreadIsReadSomewhere() {
        let read = threadsRead(
            before: list(chat("a", updated: 20, ["seenAt": 10]), chat("b")),
            now: [chat("a", updated: 20, ["seenAt": 20]), chat("b")])
        #expect(read == ["a"])
    }

    @Test func agentErrorReadsTheProvidersWords() {
        func shown(_ error: String) -> String { agentError(error).message }
        for group in ["AI & agents", "AI models"] {
            #expect(
                shown("codex was not found. Install it in Settings → \(group) → Agents, or put it on PATH.")
                    == "codex isn't installed on this computer.")
        }
        #expect(shown("Boom.\n\nTechnical details:\nstack") == "Boom.")
        #expect(
            shown(
                "{\"error\":{\"message\":\"The 'gpt-x' model is not supported when using Codex with a ChatGPT account.\"}}")
                == "gpt-x isn't available with your ChatGPT account.")
        #expect(shown("{\"detail\":1}") == "The agent couldn't finish this answer.")
        #expect(shown("oops {not json") == "oops {not json")
    }
}

struct DeepLinkTests {
    @Test func readsChatLinks() {
        #expect(parseDeepLink("relay-native://chat/abc-1") == .thread("abc-1"))
        #expect(parseDeepLink("relay-native://chat/a%20b?x=1") == .thread("a b"))
        #expect(parseDeepLink("relay-native://chat/%zz") == nil)
        #expect(parseDeepLink("relay-native://chat/") == nil)
        #expect(parseDeepLink("https://chat/abc") == nil)
        #expect(parseDeepLink("relay-native://settings") == nil)
    }
}
