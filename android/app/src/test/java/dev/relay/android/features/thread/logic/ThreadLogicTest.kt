package dev.relay.android.features.thread.logic

import dev.relay.android.features.thread.modelName
import dev.relay.android.features.thread.runningBatch
import dev.relay.android.features.thread.subagentNow
import dev.relay.android.features.thread.took
import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.AgentTrace
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.McpCall
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.StartedBy
import dev.relay.android.remote.model.SubagentRun
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Cases from shared/started-threads.test.ts, composer-quotes.test.ts and turn-feedback.test.ts,
// plus the held thread's merging rules.
class ThreadLogicTest {
    private fun child(id: String, created: Long = 2_000, running: Boolean? = null, waiting: Boolean? = null, provider: String? = null, lead: String = "lead") =
        RemoteChatSummary(id = id, projectId = "p", title = id, scope = "project", updated = created, created = created,
            running = running, waiting = waiting, provider = provider, startedBy = StartedBy(lead, "codex"))

    private fun start(id: String, detail: String? = null, status: String = "complete", detailCut: Int? = null) =
        AgentActivity(id = id, kind = "tool", label = "Started threads", status = status, detail = detail,
            detailCut = detailCut, mcp = McpCall("relay", "start_threads"))

    private fun msg(id: String = "m", body: String = "", status: String = "complete", created: Long = 1_000, ended: Long? = 5_000,
                    calls: List<AgentActivity> = emptyList(), version: Long = 1, seq: Long? = null, parentId: String? = null) =
        ChatMessage(id = id, role = "assistant", body = body, status = status, created = created, provider = "codex",
            version = version, ended = ended, seq = seq, parentId = parentId,
            trace = calls.map { AgentTrace("activity", it.id, activity = it) })

    private fun result(vararg ids: String) = ids.joinToString(",", "[", "]") { "{\"id\":\"$it\",\"title\":\"$it\"}" }

    @Test fun readsStartedIds() {
        assertEquals(listOf("a", "b"), startedIds("[{\"id\":\"a\"},{\"error\":\"bad model\"},{\"id\":\"b\"}]"))
        assertNull(startedIds("The user didn't start these threads."))
        assertNull(startedIds(result("a", "b").take(20)))
        assertNull(startedIds("[{\"error\":\"bad model\"}]"))
    }

    @Test fun listsTheLeadsThreadsByStanding() {
        val listed = startedOf("lead", listOf(
            child("done", created = 1), child("other", lead = "elsewhere"), child("working-late", 9, running = true),
            child("asks", 5, waiting = true), child("working-early", 2, running = true),
        ))
        assertEquals(listOf("asks", "working-early", "working-late", "done"), listed.map { it.id })
    }

    @Test fun groupsThreadsUnderTheirCalls() {
        val threads = listOf(child("a", 2_000), child("b", 2_100, waiting = true), child("c", 9_000))
        val groups = startGroups(msg(calls = listOf(start("s1", result("a")), start("s2", result("b", "c")))), threads)
        assertEquals(listOf(Triple("s1", 1, listOf("a")), Triple("s2", 2, listOf("b", "c"))), groups.map { Triple(it.id, it.count, it.threads.map { c -> c.id }) })
        assertEquals(3, startGroups(msg(calls = listOf(start("s1", result("a", "x", "y")))), threads)[0].count)
        for (call in listOf(start("s1"), start("s1", result("a", "b"), detailCut = 300))) {
            val fallback = startGroups(msg(calls = listOf(call)), threads)
            assertEquals(listOf(Triple("s1", 2, listOf("b", "a"))), fallback.map { Triple(it.id, it.count, it.threads.map { c -> c.id }) })
        }
        assertEquals(3, startGroups(msg(calls = listOf(start("s1")), ended = null), threads)[0].threads.size)
        assertEquals(emptyList<StartGroup>(), startGroups(msg(calls = listOf(start("s1", status = "failed"))), threads))
    }

    @Test fun saysHowTheFamilyStands() {
        assertEquals("4 threads · 2 working · 1 needs you",
            slotLine(listOf(child("a", running = true), child("b", running = true), child("c", waiting = true), child("d"))))
        assertEquals("2 threads · all done", slotLine(listOf(child("a"), child("b"))))
        assertEquals("3 agents · 2 threads working", slotLine(listOf(child("a", running = true), child("b", running = true), child("c")), 3))
        assertEquals("1 agent · 1 thread needs you", slotLine(listOf(child("a", waiting = true), child("b")), 1))
        assertEquals("2 agents · 1 thread working · 1 needs you", slotLine(listOf(child("a", running = true), child("b", waiting = true)), 2))
    }

    @Test fun startedNowSaysWhatEachThreadIsOn() {
        assertEquals(StartedNow(true, "Needs you: Which approach?"), startedNow(child("a", waiting = true), null, "Which approach?"))
        val running = child("a", running = true, provider = "codex")
        val npm = AgentActivity(id = "c", kind = "command", status = "running", label = "npm test")
        assertEquals("Codex · Running npm", startedNow(running, msg(body = "Checking", status = "streaming", calls = listOf(npm)), null).text)
        assertEquals("Codex · Now fixing the guard",
            startedNow(running, msg(body = "First I read it.\n\n**Now** fixing the guard\n", status = "streaming"), null).text)
        assertEquals("Codex · Starting…", startedNow(running, null, null).text)
        assertEquals("Done: The cache guard is fixed. added a test",
            startedNow(child("a"), msg(body = "The cache guard is **fixed**.\n\n- added a test"), null).text)
        assertEquals("Failed", startedNow(child("a"), msg(status = "failed"), null).text)
    }

    @Test fun quotesTheStartOfAMessage() {
        assertEquals("> One\n> \n> \n> \n> Two\n\n", quoteMarkdown(quoteExcerpt("One\n\n\n\nTwo  ")))
        assertEquals("line 1\nline 2\nline 3 …", quoteExcerpt((1..12).joinToString("\n") { "line $it" }, 3))
        assertEquals("alpha beta …", quoteExcerpt("alpha beta gamma delta", 8, 13))
        assertEquals("> ```ts\n>   x\n> ```\n> \n> …\n\n", quoteMarkdown(quoteExcerpt("```ts\n  x  \n\n\n  y\n```", 2)))
        assertEquals("> ~~~js\n> code\n> ~~~\n\n…", quoteExcerpt("> ~~~js\n> code\n> more\n> ~~~", 2))
        assertEquals("abc …", quoteExcerpt("abc😅def", 8, 4))
        assertEquals("```js\nx\n```", quoteExcerpt("```js\nx"))
    }

    private fun buzzes(vararg sights: TurnSight): List<TurnFeedback?> {
        var watch: TurnWatch? = null
        return sights.map { sight -> watchTurn(watch, sight).also { watch = it.first }.second }
    }

    @Test fun buzzesOncePerTurnEnd() {
        val running = TurnSight(running = true, since = 100, waiting = false)
        val done = TurnSight(running = false, waiting = false, answer = TurnAnswer(150, "complete"))
        assertEquals(listOf(null, null), buzzes(done, done))
        assertEquals(listOf(null, TurnFeedback.Success, null), buzzes(running, done, done))
        assertEquals(listOf(null, TurnFeedback.Success, null, null), buzzes(running, done, running, done))
        val streaming = TurnSight(running = false, waiting = false, answer = TurnAnswer(150, "streaming"))
        assertEquals(listOf(null, null, TurnFeedback.Success), buzzes(running.copy(answer = TurnAnswer(150, "streaming")), streaming, done))
        assertEquals(listOf(null, TurnFeedback.Warning), buzzes(running, running.copy(waiting = true)))
    }

    @Test fun heldThreadKeepsTheNewestOfEachMessage() {
        val chat = RemoteChat(id = "t", projectId = "p", title = "T", scope = ChatScope("project"),
            messages = listOf(msg("a", seq = 1), msg("b", seq = 2, version = 5)))
        assertEquals(chat, applyMessage(chat, msg("b", seq = 2, version = 4)))
        // Unsequenced messages sort after sequenced ones, even when made earlier.
        assertEquals(listOf("a", "b", "c"), applyMessage(chat, msg("c", seq = null, created = 0)).messages.map { it.id })
        val fetched = chat.copy(messages = listOf(msg("a", seq = 1, version = 2), msg("b", seq = 2, version = 3)))
        assertEquals(listOf(2L, 5L), keepNewer(fetched, chat).messages.map { it.version })
    }

    @Test fun repliesFormSideConversations() {
        val list = listOf(msg("root"), msg("r1", parentId = "root"), msg("r2", parentId = "r1"), msg("lost", parentId = "gone"), msg("next"))
        assertEquals(listOf("root", "lost", "next"), mainMessages(list).map { it.id })
        assertEquals(listOf("root", "r1", "r2"), sideConversation(list, "root").map { it.id })
        assertEquals(mapOf("root" to 2), replyCounts(list))
    }

    @Test fun subagentWords() {
        assertEquals("Opus 5.5", modelName("claude-opus-5-5"))
        assertEquals("Sonnet 4", modelName("claude-sonnet-4-20250514"))
        assertEquals("Haiku", modelName("haiku"))
        assertEquals("4m 05s", took(245_000))
        assertEquals("1h 03m", took(3_780_000))
        val run = SubagentRun(id = "a", description = "d", status = "completed", started = 0, outcome = "Found it. The bug is here.")
        assertEquals("Found it.", subagentNow(run))
        val first = run.copy(id = "1", status = "completed", started = 0, ended = 10)
        val second = run.copy(id = "2", status = "running", started = 20)
        val third = run.copy(id = "3", status = "completed", started = 25, ended = 30)
        assertEquals(listOf("2", "3"), runningBatch(listOf(first, second, third), now = 100).map { it.id })
        assertEquals(emptyList<SubagentRun>(), runningBatch(listOf(first), now = 100))
    }
}
