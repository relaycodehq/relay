package dev.relay.android.remote.outbox

import dev.relay.android.remote.client.Rejected
import dev.relay.android.remote.client.Unanswered
import dev.relay.android.remote.files.AttachedFile
import dev.relay.android.remote.files.FILES_NEED_UPDATE
import dev.relay.android.remote.files.FakeDesktopFiles
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.RemoteChat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.coroutines.EmptyCoroutineContext

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxFilesTest {
    @get:Rule val folder = TemporaryFolder()
    private val id = "22222222-2222-4222-8222-222222222222"
    private val send = ProjectChatSend(id, "@codex What's wrong here?", ModelChoice(""), "codex", "full-access", "default")

    private inner class Desktop(val files: FakeDesktopFiles = FakeDesktopFiles(), val takes: Boolean? = true) : OutboxLink {
        val sent = mutableListOf<ProjectChatSend>()
        override suspend fun send(chatId: String, send: ProjectChatSend) { sent += send }
        override suspend fun sendDraft(key: String, chatId: String, send: ProjectChatSend) = send(chatId, send)
        override suspend fun chat(chatId: String, sendId: String) = RemoteChat(id = "c", projectId = "p", title = "t", scope = ChatScope("repository"))
        override suspend fun upload(id: String, name: String, size: Long, offset: Long, data: String) = files.upload(id, name, size, offset, data)
        override val takesFiles get() = takes
    }

    private fun copy(name: String, text: String): AttachedFile {
        val dir = File(folder.root, "relay-attachments/${java.util.UUID.randomUUID()}").apply { mkdirs() }
        val f = File(dir, name).apply { writeText(text) }
        return AttachedFile(f.path, name, f.length())
    }

    @Test fun `a pending send says how much of its files went up`() {
        fun f(size: Long, received: Long, on: String? = "A", path: String? = null) =
            AttachedFile("/x", "a", size, computer = on, received = received, path = path)
        fun o(vararg files: AttachedFile) = Outgoing("A", "c", send, 0, files = files.toList())
        assertEquals(null, uploadPercent(Outgoing("A", "c", send, 0)))
        assertEquals(0, uploadPercent(o(f(100, 0, on = null))))
        assertEquals(42, uploadPercent(o(f(100, 42))))
        // One done, one halfway: 150 of 200.
        assertEquals(75, uploadPercent(o(f(100, 100, path = "/p"), f(100, 50))))
        // Bytes another computer took count for nothing here.
        assertEquals(50, uploadPercent(o(f(100, 100, on = "B", path = "/p"), f(100, 100, path = "/q"))))
        assertEquals(null, uploadPercent(o(f(100, 100, path = "/p"))))
    }

    @Test fun `files go up first, then the message names them, and the copies go`() = runTest {
        val outbox = Outbox(folder.newFolder("outbox"), backgroundScope, io = EmptyCoroutineContext)
        val desktop = Desktop()
        val clip = copy("clip.mp4", "video bytes")
        outbox.deliver(desktop, "A", "c", send, files = listOf(clip))
        runCurrent()
        val body = desktop.sent.single().body
        val path = desktop.files.done.values.single()
        assertEquals("@codex What's wrong here?\n`$path`", body)
        assertFalse(File(clip.local).exists())
    }

    @Test fun `a failing upload tries again by itself, then waits for Try again where it got to`() = runTest {
        val outbox = Outbox(null, backgroundScope, io = EmptyCoroutineContext)
        val files = FakeDesktopFiles().apply { refuse = Unanswered("Connection lost.") }
        val desktop = Desktop(files)
        outbox.deliver(desktop, "A", "c", send, files = listOf(copy("log.txt", "x".repeat(10))))
        runCurrent()
        assertEquals(1, files.calls)
        advanceTimeBy(2_001)
        assertEquals(2, files.calls)
        advanceTimeBy(8_001)
        assertEquals(3, files.calls)
        advanceTimeBy(30_001)
        assertEquals(4, files.calls)
        advanceTimeBy(60_000)
        assertEquals(4, files.calls)
        assertEquals("Connection lost.", outbox.items.value.single().error)
        assertTrue(desktop.sent.isEmpty())

        files.refuse = null
        outbox.retry(desktop, id)
        runCurrent()
        assertEquals(1, desktop.sent.size)
    }

    @Test fun `an older computer refuses files without trying again`() = runTest {
        val outbox = Outbox(null, backgroundScope, io = EmptyCoroutineContext)
        val desktop = Desktop(takes = false)
        outbox.deliver(desktop, "A", "c", send, files = listOf(copy("log.txt", "hi")))
        runCurrent()
        advanceTimeBy(60_000)
        val item = outbox.items.value.single()
        assertEquals(FILES_NEED_UPDATE, item.error)
        assertEquals(true, item.refused)
        assertEquals(0, desktop.files.calls)
    }

    @Test fun `a refusal from the computer isn't retried`() = runTest {
        val outbox = Outbox(null, backgroundScope, io = EmptyCoroutineContext)
        val files = FakeDesktopFiles().apply { refuse = Rejected("This file is too large.") }
        outbox.deliver(Desktop(files), "A", "c", send, files = listOf(copy("big.bin", "x")))
        runCurrent()
        advanceTimeBy(60_000)
        assertEquals(1, files.calls)
        assertEquals(true, outbox.items.value.single().refused)
    }

    @Test fun `a killed app resumes the upload from what it kept`() = runTest {
        val dir = folder.newFolder("outbox")
        val files = FakeDesktopFiles().apply { loseAnswerOf = 2 }
        val big = copy("clip.mp4", "y".repeat(3 * 1024 * 1024))
        val first = Outbox(dir, backgroundScope, io = EmptyCoroutineContext)
        // Retries off: the lost answer of chunk two ends this run as a crash would.
        first.deliver(Desktop(files), "A", "c", send.copy(id = id), files = listOf(big))
        runCurrent()
        val kept = Outbox(dir, backgroundScope, io = EmptyCoroutineContext).items.value.single().files!!.single()
        assertEquals(1024L * 1024, kept.received)

        files.loseAnswerOf = null
        val next = Outbox(dir, backgroundScope, io = EmptyCoroutineContext)
        val desktop = Desktop(files)
        next.retry(desktop, id)
        runCurrent()
        assertEquals("y".repeat(3 * 1024 * 1024), String(files.bytes(kept.uploadId)!!))
        assertEquals(1, desktop.sent.size)
    }
}
