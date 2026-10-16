package dev.relay.android.features.notifications

import dev.relay.android.remote.model.RemoteChatSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class HeldNewsTest {
    private fun chat(id: String, updated: Long = 10, f: RemoteChatSummary.() -> RemoteChatSummary = { this }) =
        RemoteChatSummary(id = id, projectId = "p", title = "Thread $id", scope = "project", updated = updated, created = 1).f()

    private fun list(vararg chats: RemoteChatSummary) = chats.associateBy { it.id }

    private val finished = ThreadNews("a", ThreadNews.Kind.Finished, "Thread a", "Done")
    private val failed = ThreadNews("b", ThreadNews.Kind.Failed, "Thread b", "Overloaded")
    private val asked = ThreadNews("c", ThreadNews.Kind.Waiting, "Thread c", "Claude needs you")
    private val none = emptyList<ThreadNews>()

    private fun holding(now: Map<String, RemoteChatSummary>, vararg news: ThreadNews) =
        HeldNews().also { assertEquals(none, it.next(now, present = true, news = news.toList(), at = 100)) }

    @Test fun postsAtOnceWithNobodyAtTheComputerAndHoldsUntilTheyLeave() {
        val now = list(chat("a"), chat("b"), chat("c") { copy(waiting = true) })
        assertEquals(listOf(finished), HeldNews().next(now, present = false, news = listOf(finished), at = 100))

        val held = holding(now, finished, failed, asked)
        // Still there as the list moves.
        assertEquals(none, held.next(now, present = true, news = none, at = 100))
        assertEquals(listOf(finished, failed, asked), held.next(now, present = false, news = none, at = 100))
        // Handed out once.
        assertEquals(none, held.next(now, present = false, news = none, at = 100))
    }

    @Test fun leavingWithNewNewsPostsBothOnce() {
        val now = list(chat("a"), chat("b"))
        val held = holding(now, finished)
        val again = finished.copy(body = "Done again")
        assertEquals(listOf(again, failed), held.next(now, present = false, news = listOf(failed, again), at = 100).sortedBy { it.chatId })
    }

    @Test fun dropsWhatWasHandledAtTheComputer() {
        val now = list(chat("a"), chat("b"), chat("c") { copy(waiting = true) })
        // Read, ran again, answered, gone from the list.
        val held = holding(now, finished, failed, asked)
        held.next(list(chat("a") { copy(seenAt = 10) }, chat("b", 20) { copy(running = true) }, chat("c")), present = true, news = none, at = 100)
        assertEquals(none, held.next(now, present = false, news = none, at = 100))
        assertEquals(none, holding(now, finished).next(emptyMap(), present = false, news = none, at = 100))

        // Settled or snoozed since: handled, though a failure stays news when settled.
        val settled = holding(now, finished, failed, asked)
        assertEquals(
            listOf(failed),
            settled.next(
                list(chat("a") { copy(settledAt = 10) }, chat("b") { copy(settledAt = 10) }, chat("c") { copy(waiting = true, snoozedUntil = 200) }),
                present = false, news = none, at = 100,
            ),
        )
    }

    @Test fun keepsAQuestionAThreadAlreadySnoozedAsked() {
        // threadNews tells of a snoozed thread's question, so leaving does too.
        val snoozed = list(chat("c") { copy(waiting = true, snoozedUntil = 200) })
        assertEquals(listOf(asked), holding(snoozed, asked).next(snoozed, present = false, news = none, at = 100))
    }

    @Test fun dropsAnAnswerALaterTurnReplaced() {
        // A turn that started and ended while the phone was away.
        val now = list(chat("a"), chat("b"))
        val held = holding(now, finished, failed)
        assertEquals(none, held.next(list(chat("a", 30), chat("b", 30)), present = false, news = none, at = 100))
    }

    @Test fun keepsAnAnswerWhileRelayCompactsTheThread() {
        // Compacting an unread thread before its cache goes cold runs it without moving `updated`.
        val now = list(chat("a"), chat("b"))
        val held = holding(now, finished, failed)
        val compacting = list(chat("a") { copy(running = true) }, chat("b") { copy(running = true) })
        assertEquals(none, held.next(compacting, present = true, news = none, at = 100))
        assertEquals(listOf(finished, failed), held.next(now, present = false, news = none, at = 100))
    }

    @Test fun clearsOnRequest() {
        val now = list(chat("a"))
        val held = holding(now, finished)
        held.clear()
        assertEquals(none, held.next(now, present = false, news = none, at = 100))
    }
}
