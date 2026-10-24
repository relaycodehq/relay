package dev.relay.android.remote.files

import dev.relay.android.remote.client.Unanswered
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.random.Random

class FileUploadTest {
    @get:Rule val folder = TemporaryFolder()

    private fun file(size: Int): Pair<AttachedFile, ByteArray> {
        val bytes = Random(7).nextBytes(size)
        val f = File(folder.newFolder(), "clip.mp4").apply { writeBytes(bytes) }
        return AttachedFile(f.path, f.name, size.toLong()) to bytes
    }

    @Test fun `a file goes up in chunks and comes back with its path`() = runTest {
        val (attached, bytes) = file(2 * FILE_UPLOAD_CHUNK + 5)
        val desktop = FakeDesktopFiles()
        val seen = mutableListOf<Int>()
        val done = uploadFile(desktop, attached, "A") { seen += it.percent }
        assertEquals(3, desktop.calls)
        assertArrayEquals(bytes, desktop.bytes(done.uploadId))
        assertTrue(done.path!!.endsWith("/${done.uploadId}/clip.mp4"))
        assertEquals(100, seen.last())
    }

    @Test fun `after a lost answer it carries on from what the computer has`() = runTest {
        val (attached, bytes) = file(3 * FILE_UPLOAD_CHUNK)
        val desktop = FakeDesktopFiles().apply { loseAnswerOf = 2 }
        var kept = attached
        try {
            uploadFile(desktop, attached, "A") { kept = it }
            fail("The lost answer should fail the upload.")
        } catch (_: Unanswered) {}
        // What the phone kept says one chunk; the computer has two.
        assertEquals(FILE_UPLOAD_CHUNK.toLong(), kept.received)
        desktop.loseAnswerOf = null
        val done = uploadFile(desktop, kept, "A")
        assertArrayEquals(bytes, desktop.bytes(done.uploadId))
        assertEquals(kept.uploadId, done.uploadId)
        // The repeat of chunk two is skipped, then chunk three.
        assertEquals(4, desktop.calls)
    }

    @Test fun `a computer that lost bytes gets them again`() = runTest {
        val (attached, bytes) = file(2 * FILE_UPLOAD_CHUNK)
        val desktop = FakeDesktopFiles()
        // The phone thinks it sent a chunk the computer never kept.
        val done = uploadFile(desktop, attached.copy(computer = "A", received = FILE_UPLOAD_CHUNK.toLong()), "A")
        assertArrayEquals(bytes, desktop.bytes(done.uploadId))
    }

    @Test fun `an empty file still arrives`() = runTest {
        val (attached, _) = file(0)
        val done = uploadFile(FakeDesktopFiles(), attached, "A")
        assertTrue(done.path != null)
    }
}
