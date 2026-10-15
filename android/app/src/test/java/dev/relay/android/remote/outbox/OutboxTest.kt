package dev.relay.android.remote.outbox

import dev.relay.android.remote.client.Unanswered
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.PastedImage
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.RemoteChat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Mirrors mobile/src/remote/outbox.test.ts.
@OptIn(ExperimentalCoroutinesApi::class)
class OutboxTest {
    private val id = "11111111-1111-4111-8111-111111111111"
    private val send = ProjectChatSend(id, "Fix the bug", ModelChoice(""), "codex", "full-access", "default")
    private val onComputer = HashSet<String>()
    private var hold: CompletableDeferred<Unit>? = null
    private var asked: CompletableDeferred<Unit>? = null

    private fun chat(has: Boolean) = RemoteChat(id = "c", projectId = "p", title = "t", scope = ChatScope("repository"), hasSend = has)

    private val desktop = object : OutboxLink {
        override suspend fun send(chatId: String, send: ProjectChatSend) {
            hold?.await()
            onComputer += send.id
        }
        override suspend fun sendDraft(key: String, chatId: String, send: ProjectChatSend) = send(chatId, send)
        override suspend fun chat(chatId: String, sendId: String): RemoteChat {
            asked?.await()
            return chat(sendId in onComputer)
        }
    }
    private val dropped = object : OutboxLink {
        override suspend fun send(chatId: String, send: ProjectChatSend) = throw Unanswered("Connection lost.")
        override suspend fun sendDraft(key: String, chatId: String, send: ProjectChatSend) = throw Unanswered("Connection lost.")
        override suspend fun chat(chatId: String, sendId: String) = throw Unanswered("Connection lost.")
    }

    @Test fun `doesn't resend an unanswered send Edit is asking about`() = runTest {
        val outbox = Outbox(null, backgroundScope)
        outbox.deliver(dropped, "A", "c", send)
        runCurrent()
        val unsent = outbox.of("A", "c").single()
        assertEquals(true, unsent.unsure)
        asked = CompletableDeferred()
        val asking = async { outbox.reached(desktop, unsent) }
        runCurrent()
        outbox.resendFailed(desktop, "A")
        asked!!.complete(Unit)
        assertFalse(asking.await())
        runCurrent()
        assertFalse(id in onComputer)
    }

    @Test fun `lets a resend on its way land before answering Edit`() = runTest {
        val outbox = Outbox(null, backgroundScope)
        outbox.deliver(dropped, "A", "c", send)
        runCurrent()
        hold = CompletableDeferred()
        outbox.resendFailed(desktop, "A")
        val unsent = outbox.of("A", "c").single()
        val asking = async { outbox.reached(desktop, unsent) }
        runCurrent()
        hold!!.complete(Unit)
        assertTrue(asking.await())
    }

    @Test fun `forgets the ones the thread holds or took before a fetch`() {
        val a = Outgoing("A", "c", send, 1, sent = 3)
        val b = Outgoing("A", "c", send.copy(id = "b"), 2)
        assertEquals(listOf(a), settled(listOf(a, b), "A", "c", emptySet(), 4))
        assertEquals(listOf(b), settled(listOf(a, b), "A", "c", setOf("b"), 2))
    }

    @Test fun `shows a pending message with its images and error`() {
        val image = PastedImage("shot.jpg", "image/jpeg", "x".repeat(400))
        val o = Outgoing("A", "c", send.copy(images = listOf(image), side = true), 5, error = "Gone", unsure = true)
        val message = outgoingMessage(o)
        assertEquals("Maybe not sent: Gone", message.error)
        assertEquals(300L, message.images!!.single().sizeBytes)
        assertEquals("$id:0", message.images!!.single().id)
        assertEquals(true, message.pending)
        assertEquals(true, message.side)
    }
}
