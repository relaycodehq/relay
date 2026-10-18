package dev.relay.android.features.images

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.AgentTrace
import dev.relay.android.remote.model.ChatImage
import dev.relay.android.remote.model.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImagesTest {
    @Test fun centresAnUnzoomedImageAndLimitsPanningToItsEdges() {
        assertEquals(PanLimits(0f, 0f), imageLimits(2f, 400f, 800f, 1f))
        assertEquals(PanLimits(400f, 0f), imageLimits(2f, 400f, 800f, 3f))
        assertEquals(PanLimits(200f, 400f), imageLimits(0.5f, 400f, 800f, 2f))
        // After unfolding and turning, without a new load.
        assertEquals(PanLimits(400f, 800f), imageLimits(0.5f, 400f, 800f, 3f))
        assertEquals(PanLimits(200f, 800f), imageLimits(0.5f, 800f, 800f, 3f))
        assertEquals(PanLimits(0f, 400f), imageLimits(0.5f, 800f, 400f, 3f))
    }

    private val root = "/work/relay"

    @Test fun resolvesTheFormsAnAgentWritesAnImageIn() {
        assertEquals("/tmp/after.png", localImagePath("/tmp/after.png", root))
        assertEquals("/work/relay/docs/shot.png", localImagePath("docs/shot.png", root))
        assertEquals("/work/relay/b.jpg", localImagePath("./a/../b.jpg", root))
        assertEquals("/tmp/my shot.png", localImagePath("file:///tmp/my%20shot.png", root))
        assertEquals("/work/relay/shots/my shot.webp", localImagePath("shots/my%20shot.webp", root))
    }

    @Test fun leavesOutWhatIsntALocalImage() {
        assertNull(localImagePath("https://example.com/a.png", root))
        assertNull(localImagePath("data:image/png;base64,AAAA", root))
        assertNull(localImagePath("/etc/passwd", root))
        assertNull(localImagePath("notes.svg", root))
        assertNull(localImagePath("%E0%A4%A.png", root))
    }

    @Test fun listsOnlyEmbeddedImages() {
        val body = listOf(
            "Before: ![](/tmp/before.png) and after: ![after](<shots/after.png> \"title\")",
            "A [link](/tmp/link.png), `/tmp/code.png`, and ![](https://x.dev/r.png).",
            "Again ![](/tmp/before.png), and ![shot](</tmp/my screenshot.png>)",
        ).joinToString("\n")
        assertEquals(listOf("/tmp/before.png", "/work/relay/shots/after.png", "/tmp/my screenshot.png"),
            answerImagePaths(body, root))
    }

    private fun read(id: String, path: String, status: String = "complete") =
        AgentTrace("activity", id, activity = AgentActivity(id, "read", path, status))

    private fun message(status: String, body: String = "", trace: List<AgentTrace> = emptyList()) = ChatMessage(
        id = "m", role = "assistant", body = body, status = status, created = 0, provider = "claude", version = 1,
        images = listOf(ChatImage("i1", "paste.png", "image/png", 10)),
        trace = trace,
    )

    @Test fun ordersPastedThenShownThenReadOnceTheTurnEnds() {
        val trace = listOf(read("a", "/tmp/shown.png"), read("b", "/tmp/read.png"), read("c", "/tmp/run.png", "running"))
        val done = messageImages("c", message("complete", "See ![s](/tmp/shown.png)", trace), root)
        assertEquals(
            listOf(ImageSource.Attached("c", "i1"), ImageSource.Read("c", "m", "/tmp/shown.png"), ImageSource.Read("c", "m", "/tmp/read.png")),
            done.all.map { it.source },
        )
        assertEquals(listOf("paste.png", "read.png"), done.strip.map { it.name })
        assertEquals(2, done.looked.size)

        val streaming = messageImages("c", message("streaming", "See ![s](/tmp/shown.png)", trace), root)
        assertEquals(listOf(ImageSource.Attached("c", "i1")), streaming.all.map { it.source })
        assertEquals(2, streaming.looked.size)
    }
}
