package dev.relay.android.features.thread.logic

import dev.relay.android.features.composer.logic.implementPlan
import dev.relay.android.remote.model.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

// Cases from shared/open-plan.test.ts.
class OpenPlanTest {
    private var seq = 0L
    private fun message(id: String, role: String, body: String = id, parentId: String? = null, plan: Boolean? = null, status: String = "complete") =
        (++seq).let {
            ChatMessage(id = id, role = role, body = body, status = status, created = it, seq = it, provider = "claude",
                version = 1, parentId = parentId, proposedPlan = plan)
        }

    private val other = message("other", "assistant")
    private val ask = message("ask", "user", "@claude plan retries")
    private val plan = message("plan", "assistant", plan = true)
    private val goAhead = message("go", "user", implementPlan("claude"))
    private val build = message("build", "assistant")

    @Test fun offersAFreshPlanEndingTheMainConversation() {
        val thread = listOf(ask, plan)
        assertEquals("claude", openPlan(thread, mainMessages(thread)))
    }

    @Test fun notInItsRepliesOnceTheMainConversationWentAhead() {
        val thread = listOf(ask, plan, goAhead, build)
        assertSame(plan, sideConversation(thread, plan.id).last())
        assertNull(openPlan(thread, sideConversation(thread, plan.id)))
        assertNull(openPlan(thread, mainMessages(thread)))
    }

    @Test fun notWhileTheGoAheadIsNewest() {
        val thread = listOf(ask, plan, goAhead)
        assertNull(openPlan(thread, sideConversation(thread, plan.id)))
    }

    @Test fun notInTheMainConversationWhenCarriedOutInItsReplies() {
        val reply = message("reply-go", "user", implementPlan("claude"), parentId = plan.id)
        val thread = listOf(ask, plan, reply)
        assertNull(openPlan(thread, mainMessages(thread)))
    }

    @Test fun offersASidePlanAsThatConversationsLastWord() {
        val root = message("root", "assistant")
        val question = message("q", "user", parentId = root.id)
        val sidePlan = message("side-plan", "assistant", parentId = question.id, plan = true)
        val later = message("later", "user")
        val thread = listOf(root, question, sidePlan, later)
        assertEquals("claude", openPlan(thread, sideConversation(thread, root.id)))
    }

    @Test fun leavesTheMainPlanOpenBesideAnUnrelatedSideConversation() {
        val aside = message("aside", "user", parentId = other.id)
        val thread = listOf(other, ask, plan, aside)
        assertEquals("claude", openPlan(thread, mainMessages(thread)))
    }

    @Test fun nothingForAnUnfinishedPlan() {
        val streaming = plan.copy(status = "streaming")
        assertNull(openPlan(listOf(ask, streaming), listOf(ask, streaming)))
    }
}
