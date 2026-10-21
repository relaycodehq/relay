package dev.relay.android.features.composer.logic

import dev.relay.android.remote.model.AgentQuestion
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.SubagentRun
import dev.relay.android.features.thread.subagentNow
import org.junit.Assert.assertEquals
import org.junit.Test

class AntigravityTest {
    @Test fun `native choice ids and independent quota pool names survive decoding`() {
        val question = RemoteJson.decodeFromString<AgentQuestion>("""{"id":"interaction_env","question":"Which environment?","allowCustomAnswer":false,"options":[{"label":"Same","value":"dev"},{"label":"Same","value":"prod"}]}""")
        assertEquals(false, question.allowCustomAnswer)
        assertEquals(listOf("dev", "prod"), question.options?.map { it.value })
        val window = RemoteJson.decodeFromString<UsageWindow>("""{"id":"3p-5h","label":"Claude & GPT · 5h","kind":"session","usedPercent":25,"resetsAt":null,"periodMs":18000000}""")
        assertEquals("Claude & GPT · 5h", presentWindow(window, 0).label)
        assertEquals(true, reportsUsage("antigravity"))
    }

    @Test fun `batches do not pretend their children succeeded or can be stopped`() {
        val batch = RemoteJson.decodeFromString<SubagentRun>("""{"id":"batch","description":"Antigravity subagent batch","status":"idle","canStop":false,"started":0}""")
        assertEquals(false, batch.canStop)
        assertEquals("Child status unavailable", subagentNow(batch))
    }
}
