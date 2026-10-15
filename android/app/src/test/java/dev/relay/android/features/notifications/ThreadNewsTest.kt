package dev.relay.android.features.notifications

import dev.relay.android.remote.model.LimitResume
import dev.relay.android.remote.model.RemoteChatSummary
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

/** shared/thread-news.test.ts against the Kotlin port. */
class ThreadNewsTest {
    private fun chat(id: String, updated: Long = 10, f: RemoteChatSummary.() -> RemoteChatSummary = { this }) =
        RemoteChatSummary(id = id, projectId = "p", title = "Thread $id", scope = "project", updated = updated, created = 1, provider = "claude").f()

    private fun list(vararg chats: RemoteChatSummary) = chats.associateBy { it.id }
    private fun answer(status: String = "complete", body: String = "", error: String? = null) =
        LastAnswer(status, body, error, "claude")

    @Test fun keepsQuietAboutACompactionThatRanWhileYouWereAway() {
        val news = threadNews(list(chat("a") { copy(running = true) }), listOf(chat("a")), mapOf("a" to answer(body = "The answer before it")))
        assertEquals(emptyList<ThreadNews>(), news)
    }

    @Test fun tellsOfAFinishedAnswerByItsFirstWordsAndAFailedOneByItsError() {
        val before = list(chat("a") { copy(running = true) }, chat("b") { copy(running = true) }, chat("c") { copy(running = true) })
        val news = threadNews(
            before,
            listOf(chat("a", 20), chat("b", 20), chat("c", 20)),
            mapOf(
                "a" to answer(body = "## Done\n\nFixed **the** [race](src/x.ts) in `turn-run.ts`."),
                "b" to answer("failed", error = "Claude's login expired."),
                "c" to answer(
                    "failed",
                    error = "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}",
                ),
            ),
        )
        assertEquals(
            listOf(
                ThreadNews("a", ThreadNews.Kind.Finished, "Thread a", "Done: Fixed the race in turn-run.ts."),
                ThreadNews("b", ThreadNews.Kind.Failed, "Thread b", "Claude's login expired."),
                ThreadNews("c", ThreadNews.Kind.Failed, "Thread c", "Overloaded"),
            ),
            news,
        )
    }

    @Test fun tellsOfAQuestionAtOnceEvenWhileTheAgentStillRuns() {
        val news = threadNews(
            list(chat("a") { copy(running = true) }),
            listOf(chat("a") { copy(running = true, waiting = true, asking = true) }),
            emptyMap(),
        )
        assertEquals(listOf(ThreadNews("a", ThreadNews.Kind.Waiting, "Thread a", "Claude needs you")), news)
    }

    @Test fun staysQuietAboutNewStoppedSnoozedAndReadThreads() {
        val before = list(
            chat("stopped") { copy(running = true) },
            chat("snoozed") { copy(running = true) },
            chat("watched") { copy(running = true) },
        )
        val news = threadNews(
            before,
            listOf(
                chat("new") { copy(waiting = true) },
                chat("stopped"),
                chat("snoozed") { copy(snoozedUntil = 5_000) },
                chat("watched", 20) { copy(seenAt = 20) },
            ),
            mapOf("stopped" to answer("cancelled")),
            1_000,
        )
        assertEquals(emptyList<ThreadNews>(), news)
    }

    @Test fun quietForThreadsSettledWhileRunningButTellsOfOneThatWokeUp() {
        fun RemoteChatSummary.whileRunning() = copy(settledAt = 15, settleWhenDone = 15)
        val news = threadNews(
            list(
                chat("settling") { copy(running = true).whileRunning() },
                chat("settled") { copy(running = true).whileRunning() },
                chat("failed") { copy(running = true).whileRunning() },
                chat("woke") { copy(running = true, settledAt = 5) },
            ),
            listOf(
                chat("settling", 20) { whileRunning() },
                chat("settled", 20) { copy(settledAt = 21) },
                chat("failed", 20) { whileRunning() },
                chat("woke", 20) { copy(settledAt = 5) },
            ),
            mapOf("failed" to answer("failed", error = "Boom.")),
        )
        assertEquals(
            listOf("failed" to ThreadNews.Kind.Failed, "woke" to ThreadNews.Kind.Finished),
            news.map { it.chatId to it.kind },
        )
    }

    @Test fun stillReportsAFailedTurnWhileAnEarlierQuestionRemainsOpen() {
        val news = threadNews(
            list(chat("a") { copy(running = true, waiting = true, asking = true) }),
            listOf(chat("a", 20) { copy(waiting = true, asking = true) }),
            mapOf("a" to answer("failed", error = "API Error: 529 {\"error\":{\"message\":\"Overloaded\"}}")),
        )
        assertEquals(listOf(ThreadNews("a", ThreadNews.Kind.Failed, "Thread a", "Overloaded")), news)
    }

    @Test fun tellsOfAUsageLimitWithItsResumeTime() {
        val zone = ZoneId.of("Europe/Prague")
        val now = ZonedDateTime.of(2026, 10, 14, 10, 0, 0, 0, zone).toInstant().toEpochMilli()
        val resume = ZonedDateTime.of(2026, 10, 15, 9, 0, 0, 0, zone).toInstant().toEpochMilli()
        val news = threadNews(
            list(chat("a") { copy(running = true) }),
            listOf(chat("a") { copy(running = true, limitResume = LimitResume("m", "codex", resume)) }),
            emptyMap(), now, zone,
        )
        assertEquals(ThreadNews.Kind.Failed, news.single().kind)
        assertEquals(true, news.single().body.startsWith("Codex hit its usage limit · resumes the answer at tomorrow "))
    }

    @Test fun clearsANotificationOnceTheThreadIsReadSomewhere() {
        assertEquals(
            listOf("a"),
            threadsRead(list(chat("a", 20) { copy(seenAt = 10) }, chat("b")), listOf(chat("a", 20) { copy(seenAt = 20) }, chat("b"))),
        )
    }

    @Test fun previewLeavesCodeOutAndCutsLongAnswers() {
        assertEquals("Run this: then look.", preview("Run this:\n```sh\nnpm test\n```\nthen look."))
        assertEquals(240, preview("word ".repeat(100)).length)
        assertEquals("Proposed plan: Add retries to sync", preview("## Proposed plan\n\n1. Add **retries** to `sync`"))
        assertEquals("Done? Yes.", preview("# Done?\nYes."))
        assertEquals("Summary", preview("## Summary"))
        assertEquals(80, preview("word ".repeat(100), 80).length)
    }

    @Test fun agentErrorReadsTheProvidersWords() {
        assertEquals("codex isn't installed on this computer.",
            agentError("codex was not found. Install it in Settings → AI models → Agents, or put it on PATH."))
        assertEquals("Boom.", agentError("Boom.\n\nTechnical details:\nstack"))
        assertEquals("gpt-x isn't available with your ChatGPT account.",
            agentError("{\"error\":{\"message\":\"The 'gpt-x' model is not supported when using Codex with a ChatGPT account.\"}}"))
        assertEquals("The agent couldn't finish this answer.", agentError("{\"detail\":1}"))
        assertEquals("oops {not json", agentError("oops {not json"))
    }

    @Test fun namesAgents() {
        assertEquals("OpenCode", agentName("opencode"))
        assertEquals("Gemini Cli", agentName("acp:gemini-cli"))
    }

    @Test fun wakeLabelSaysTodayTomorrowWeekdayOrDate() {
        val zone = ZoneId.of("UTC")
        val now = ZonedDateTime.of(2026, 10, 14, 10, 0, 0, 0, zone).toInstant().toEpochMilli()
        fun at(d: Int, h: Int) = ZonedDateTime.of(2026, 10, d, h, 30, 0, 0, zone).toInstant().toEpochMilli()
        assertEquals("5:30 PM", wakeLabel(at(14, 17), now, zone, Locale.US).replace("\u202F", " "))
        assertEquals("tomorrow 9:30 AM", wakeLabel(at(15, 9), now, zone, Locale.US).replace("\u202F", " "))
        assertEquals("Sat 9:30 AM", wakeLabel(at(17, 9), now, zone, Locale.US).replace("\u202F", " "))
        assertEquals("Oct 30, 9:30 AM", wakeLabel(at(30, 9), now, zone, Locale.US).replace("\u202F", " "))
    }
}
