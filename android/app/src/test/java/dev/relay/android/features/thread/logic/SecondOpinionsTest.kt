package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.StartedBy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Mirrored in ios/RelayKit/Tests/RelayRemoteTests/SecondOpinionsTests.swift.
class SecondOpinionsTest {
    private fun answer(body: String = "It holds.", status: String = "complete", parentId: String? = null, side: Boolean? = null, role: String = "assistant") =
        ChatMessage(id = "a", role = role, body = body, status = status, created = 1, provider = "claude", version = 1, parentId = parentId, side = side)

    private fun thread(id: String, on: String? = null, lead: String = "lead", created: Long = 1, running: Boolean? = null) =
        RemoteChatSummary(id = id, projectId = "p", title = id, scope = "project", updated = created, created = created,
            running = running, startedBy = StartedBy(lead, "claude", secondOpinionOn = on))

    @Test fun offersOnlyFinishedMainAnswers() {
        assertTrue(offersSecondOpinion(answer()))
        assertFalse(offersSecondOpinion(answer(status = "streaming")))
        assertFalse(offersSecondOpinion(answer(body = "  ")))
        assertFalse(offersSecondOpinion(answer(parentId = "q")))
        assertFalse(offersSecondOpinion(answer(side = true)))
        assertFalse(offersSecondOpinion(answer(role = "user")))
    }

    @Test fun findsTheOpinionsOnOneAnswer() {
        val chats = listOf(thread("late", on = "a", created = 3), thread("other", on = "b"), thread("started"), thread("early", on = "a", created = 2),
            thread("elsewhere", on = "a", lead = "x"))
        assertEquals(listOf("early", "late"), opinionsOn("lead", "a", chats).map { it.id })
    }

    @Test fun keepsOpinionsOutOfTheStartedThreads() {
        assertEquals(listOf("started"), startedOf("lead", listOf(thread("opinion", on = "a"), thread("started"))).map { it.id })
    }

    @Test fun standsByItsLatestAnswer() {
        assertEquals("working", opinionStanding(thread("o", running = true), answer()))
        assertEquals("working", opinionStanding(thread("o"), null))
        assertEquals("failed", opinionStanding(thread("o"), answer(status = "failed")))
        assertEquals("stopped", opinionStanding(thread("o"), answer(status = "cancelled")))
        assertEquals("finished", opinionStanding(thread("o"), answer()))
    }

    @Test fun namesWhoGivesIt() {
        assertEquals("Second opinion · GPT-5.5", opinionTitle("codex", "GPT-5.5"))
        assertEquals("Second opinion · Codex", opinionTitle("codex", ""))
        assertEquals("Second opinion", opinionTitle(null, null))
        assertEquals("Claude hasn't seen this.", unsentLine("claude", null))
        assertEquals("It's on lubopc now", unsentLine("claude", "It's on lubopc now"))
    }
}
