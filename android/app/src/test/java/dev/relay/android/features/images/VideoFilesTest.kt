package dev.relay.android.features.images

import java.nio.file.Files
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoFilesTest {
    private val dir = Files.createTempDirectory("videos").toFile()
    private val video = ByteArray(2500) { it.toByte() }

    /** Serves [video] in pieces of 1000 bytes, as the computer serves a megabyte. */
    private fun serve(asked: MutableList<Long> = mutableListOf()): suspend (Long) -> VideoPart = { offset ->
        asked += offset
        val piece = video.copyOfRange(offset.toInt(), minOf(video.size, offset.toInt() + 1000))
        VideoPart(video.size.toLong(), Base64.getEncoder().encodeToString(piece))
    }

    @Test fun downloadsAVideoPieceByPieceAndKeepsIt() = runBlocking {
        val asked = mutableListOf<Long>()
        val file = VideoFiles(dir).download("a", "/tmp/clip.mp4", serve(asked))
        assertArrayEquals(video, file.readBytes())
        assertEquals(listOf(0L, 1000L, 2000L), asked)
        assertTrue(file.name.endsWith(".mp4"))
        // Played again, it comes from the phone.
        VideoFiles(dir).download("a", "/tmp/clip.mp4", serve(asked))
        assertEquals(3, asked.size)
    }

    @Test fun dropsTheLeastRecentlyPlayedPastItsRoom() = runBlocking {
        val files = VideoFiles(dir, keepBytes = 6000)
        val first = files.download("a", "a.mp4", serve())
        first.setLastModified(1_000)
        files.download("b", "b.mp4", serve())
        val third = files.download("c", "c.mp4", serve())
        assertFalse(first.exists())
        assertTrue(third.exists())
    }

    @Test(expected = VideoTooBig::class)
    fun refusesAVideoTooBigToPull(): Unit = runBlocking {
        VideoFiles(dir).download("a", "a.mp4", { VideoPart(MAX_VIDEO_BYTES + 1, "") })
    }
}
