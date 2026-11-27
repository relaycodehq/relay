package dev.relay.android.remote.outbox

import dev.relay.android.remote.client.NotConnected
import dev.relay.android.remote.client.Unanswered
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.RemoteChat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** New threads this phone names: the outbox makes each before its first message goes. */
@OptIn(ExperimentalCoroutinesApi::class)
class OutboxThreadsTest {
    @get:Rule val folder = TemporaryFolder()
    private val thread = ThreadToMake("p", "checkout")

    private fun send(id: String) = ProjectChatSend(id, "Look at this", ModelChoice(""), "codex", "full-access", "default")

    private class Desktop : OutboxLink {
        val calls = mutableListOf<String>()
        var gate: CompletableDeferred<Unit>? = null
        var refuse: Exception? = null
        override suspend fun make(chatId: String, thread: ThreadToMake) {
            calls += "make $chatId"
            gate?.await()
            refuse?.let { refuse = null; throw it }
        }
        override suspend fun send(chatId: String, send: ProjectChatSend) { calls += "send ${send.id}" }
        override suspend fun sendDraft(key: String, chatId: String, send: ProjectChatSend) = send(chatId, send)
        override suspend fun chat(chatId: String, sendId: String) = RemoteChat(id = chatId, projectId = "p", title = "t", scope = ChatScope("repository"))
    }

    @Test fun `the thread is made before its message goes`() = runTest {
        val outbox = Outbox(null, backgroundScope)
        val desktop = Desktop()
        outbox.deliver(desktop, "A", "t1", send("m1"), make = thread)
        runCurrent()
        assertEquals(listOf("make t1", "send m1"), desktop.calls)
        assertNull(outbox.items.value.single().make)
    }

    @Test fun `a second message waits for its thread to be made, which is made once`() = runTest {
        val outbox = Outbox(null, backgroundScope)
        val desktop = Desktop().apply { gate = CompletableDeferred() }
        outbox.deliver(desktop, "A", "t1", send("m1"), make = thread)
        runCurrent()
        outbox.deliver(desktop, "A", "t1", send("m2"))
        runCurrent()
        assertEquals(listOf("make t1"), desktop.calls)
        desktop.gate!!.complete(Unit)
        runCurrent()
        assertEquals("make t1", desktop.calls.first())
        assertEquals(setOf("send m1", "send m2"), desktop.calls.drop(1).toSet())
    }

    @Test fun `a make that got no answer fails the send, and Try again makes it again`() = runTest {
        val outbox = Outbox(null, backgroundScope)
        val desktop = Desktop().apply { refuse = Unanswered("Connection lost.") }
        outbox.deliver(desktop, "A", "t1", send("m1"), make = thread)
        runCurrent()
        val failed = outbox.items.value.single()
        assertNotNull(failed.error)
        assertEquals(thread, failed.make)
        outbox.retry(desktop, "m1")
        runCurrent()
        assertEquals(listOf("make t1", "make t1", "send m1"), desktop.calls)
    }

    @Test fun `one Relay closed on still makes its thread on the next launch`() = runTest {
        val dir = folder.newFolder("outbox")
        val offline = object : OutboxLink by Desktop() {
            override suspend fun make(chatId: String, thread: ThreadToMake) = throw NotConnected("Not connected.")
        }
        Outbox(dir, backgroundScope).deliver(offline, "A", "t1", send("m1"), make = thread)
        runCurrent()
        val again = Outbox(dir, backgroundScope)
        assertEquals(thread, again.items.value.single().make)
        // Its thread was never made, so it can't have reached the computer.
        assertEquals(false, again.reached(Desktop(), again.items.value.single()))
    }
}
