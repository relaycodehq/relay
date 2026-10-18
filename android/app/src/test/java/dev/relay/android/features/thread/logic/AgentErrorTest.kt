package dev.relay.android.features.thread.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Cases from shared/agent-error.test.ts.
class AgentErrorTest {
    @Test fun aMissingCliIsNotInstalledInEitherWording() {
        // An older desktop's stored error names the Settings group "AI models".
        for (group in listOf("AI & agents", "AI models")) {
            val shown = agentError("codex was not found. Install it in Settings → $group → Agents, or put it on PATH.")
            assertTrue(shown.notInstalled)
            assertEquals("codex isn't installed on this computer.", shown.message)
            assertEquals("Set it up in Settings → AI & agents → Agents, or put it on PATH, then send again.", shown.hint)
        }
        assertFalse(agentError("codex crashed").notInstalled)
    }
}
