package dev.relay.android.features.composer.logic

import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.ResumeSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Mirrors shared/compose-send.test.ts and the remote-compose pieces the phone leans on.
class ComposeSendTest {
    private val claude = SendSettings(
        to = "claude",
        choice = ModelChoice(model = "opus", reasoningEffort = "high", fast = true),
        contextWindow = "200k",
        runtimeMode = "full-access",
        interactionMode = "default",
    )

    @Test fun `steers a running answer or queues behind it`() {
        val steered = buildSend(claude, "plan retries", SendOptions(steer = true))
        assertEquals("@claude plan retries", steered.body)
        assertEquals("steer", steered.delivery)
        assertEquals(false, steered.choice.fast)
        assertEquals("200k", steered.contextWindow)
        assertEquals("queue", buildSend(claude, "x", SendOptions(steer = false)).delivery)
    }

    @Test fun `a scheduled send has no delivery`() {
        val sent = buildSend(claude, "x", SendOptions(steer = true, sendAt = 5))
        assertEquals(5L, sent.sendAt)
        assertNull(sent.delivery)
    }

    @Test fun `asks for no context window on a model with 1M built in`() {
        assertNull(buildSend(claude.copy(choice = claude.choice.copy(model = "opus[1m]")), "hi").contextWindow)
    }

    @Test fun `says who answers in to and in the body`() {
        val asked = buildSend(claude, "look")
        assertEquals("claude", asked.to)
        assertEquals("claude", asked.provider)
        val note = buildSend(claude.copy(to = "message"), " remember this ")
        assertEquals("message", note.to)
        assertEquals("remember this", note.body)
        for (s in listOf(asked, note)) assertEquals(s.to, recipient(s.copy(to = null)))
    }

    @Test fun `a message naming another agent goes to it on its Default`() {
        val sent = buildSend(claude, "@codex look")
        assertEquals("@codex look", sent.body)
        assertEquals("codex", sent.to)
        assertEquals("codex", sent.provider)
        assertEquals(byDefault, sent.choice)
        assertNull(sent.contextWindow)
    }

    @Test fun `a failed send taken back to edit brings back who it was for`() {
        val other = sentWith(buildSend(claude, "@codex look"))!!
        assertEquals("codex", other.provider)
        assertEquals(byDefault, other.choice)
        assertEquals("opus", sentWith(buildSend(claude, "look"))!!.choice.model)
        assertNull(sentWith(buildSend(claude.copy(to = "message"), "remember this")))
    }

    @Test fun `goes ahead with a plan on the planner's own model`() {
        val (send, next) = planGoAhead(claude.copy(interactionMode = "plan"), "claude")
        assertEquals("@claude Implement the plan from your previous response.", send.body)
        assertEquals("default", send.interactionMode)
        assertEquals(ModelChoice("opus", fast = false, reasoningEffort = "high"), send.choice)
        assertEquals("200k", send.contextWindow)
        assertEquals(claude, next)
    }

    @Test fun `hands a plan to another planner on its Default`() {
        val codex = SendSettings("codex", ModelChoice("gpt-5.5", true, "high"), null, "approval-required", "plan")
        val (send, next) = planGoAhead(codex, "claude")
        assertEquals("claude", send.provider)
        assertEquals("approval-required", send.runtimeMode)
        assertEquals(byDefault, send.choice)
        assertNull(send.contextWindow)
        assertEquals(SendSettings("claude", byDefault, null, "approval-required", "default"), next)
    }

    @Test fun `a new thread opens on the remembered model, Full access and Build`() {
        val models = mapOf("claude" to NewThreadModel(ModelChoice("opus", false, "max"), "200k"))
        val s = newThreadSettingsFrom("claude", null, models)
        assertEquals(ResumeSettings("claude", ModelChoice("opus", false, "max"), "200k", "full-access", "default"), s)
        val codex = newThreadSettings(NewThreadAI("codex", "codex", ModelChoice("gpt-6-sol")))
        assertEquals("gpt-6-sol", codex.choice.model)
        assertEquals("codex", newThreadSettingsFrom("nobody-knows", null, emptyMap()).provider)
    }

    @Test fun `a composer command on another agent's model switches to it`() {
        val s = ResumeSettings("codex", ModelChoice("gpt-6-sol", true, "xhigh"), null, "full-access", "default")
        val next = withComposerChange(s, ComposerChange.Model("claude", "opus"), emptyMap())
        assertEquals("claude", next.provider)
        assertEquals(ModelChoice("opus", false, ""), next.choice)
        assertEquals("plan", withComposerChange(s, ComposerChange.Plan(true), emptyMap()).interactionMode)
    }

    @Test fun `a side reply elsewhere hands the next send to the holder`() {
        val last = ResumeSettings("codex", ModelChoice("x"), null, "auto", "default")
        assertEquals("claude", conversationSettings(last, "root", null, "claude").provider)
        assertEquals("codex", conversationSettings(last, null, null, "claude").provider)
    }
}
