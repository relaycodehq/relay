package dev.relay.android.remote.files

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Test

class AttachedFilesTest {
    @Test fun `chunks start where the computer got to and stop at the end`() {
        assertEquals(0L until 1024L * 1024, nextChunk(0, 5_000_000))
        assertEquals(4_194_304L until 5_000_000L, nextChunk(4_194_304, 5_000_000))
        assertEquals(0L until 0L, nextChunk(0, 0))
        // A computer that says it has more than the file is held to the file.
        assertEquals(10L until 10L, nextChunk(12, 10))
    }

    @Test fun `files go on lines of their own after the text`() {
        assertEquals("Look at this\n`/a/clip.mp4`\n`/a/log.txt`", bodyWithFiles(" Look at this \n", listOf("/a/clip.mp4", "/a/log.txt")))
        assertEquals("`/a/clip.mp4`", bodyWithFiles("", listOf("/a/clip.mp4")))
        assertEquals("Just text", bodyWithFiles("Just text", emptyList()))
    }

    @Test fun `a sent file shows as its name`() {
        val mac = "`/Users/me/Library/Application Support/Relay/pastes/0b5e2f9e-7d8c-4a38-9f3e-2b2c6c7d9a10/bug repro.mp4`"
        val windows = "`C:\\Users\\me\\AppData\\Roaming\\Relay\\pastes\\0b5e2f9e-7d8c-4a38-9f3e-2b2c6c7d9a10\\log.txt`"
        val shown = shownFiles("Why?\n$mac\n$windows")
        assertEquals("Why?\nbug repro.mp4\nlog.txt", shown.text)
        assertEquals(listOf(5..17, 19..25), shown.names)
        // Other code stays as it was.
        assertEquals("`src/app.ts`", shownFiles("`src/app.ts`").text)
    }

    @Test fun `sizes read as the strip shows them`() {
        assertEquals("512 B", fileSize(512))
        assertEquals("820 KB", fileSize(820_000))
        assertEquals("12.4 MB", fileSize(12_400_000))
        assertEquals("1.2 GB", fileSize(1_200_000_000))
    }

    @Test fun `a file bound for another computer starts over under a new id`() {
        val sent = AttachedFile("/x", "a.mp4", 10, uploadId = "u", computer = "A", received = 10, path = "/p")
        assertSame(sent, sent.on("A"))
        val other = sent.on("B")
        assertNotEquals("u", other.uploadId)
        assertEquals(0L, other.received)
        assertEquals(null, other.path)
        assertEquals("B", other.computer)
    }
}
