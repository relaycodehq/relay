package dev.relay.android.features.composer

import dev.relay.android.remote.drafts.DraftStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ComposerDraftTest {
    private val pc = "computer-1"

    private fun photos(count: Int) = (1..count).map {
        Attachment("photo-$it", "photo-$it.jpg", "image/jpeg", "data:image/jpeg;base64,AAAA")
    }

    @Test fun `moving a draft keeps every photo in both drafts`() {
        val from = "photo-count-from"
        val to = "photo-count-to"
        UnsentDrafts.of(pc, from).images.value = photos(10)
        UnsentDrafts.of(pc, to).images.value = photos(2)
        UnsentDrafts.move(pc, from, to)
        assertEquals(12, UnsentDrafts.of(pc, to).images.value.size)
        assertEquals(0, UnsentDrafts.of(pc, from).images.value.size)
    }

    @Test fun `taking a send back restores every photo after the draft's photos`() {
        val back = Returned("Review these", photos(10).map { it.pasted() })
        val (text, restored) = returnedDraft("Keep this", photos(2), back)
        assertEquals("Keep this\n\nReview these", text)
        assertEquals(12, restored.size)
    }

    @Test fun `a new thread's text moved to a project with a draft loads there once`() = runTest {
        val drafts = DraftStore(null, backgroundScope)
        drafts.editText(pc, "new:a:1", "A")
        drafts.editText(pc, "new:b:1", "B")
        drafts.move(pc, "new:a:1", "new:b:1")
        assertEquals("B\n\nA", drafts.text(pc, "new:b:1"))
        // The field still shows "A", which was the old key's draft and moved with it.
        assertEquals("B\n\nA", loadedText(drafts.text(pc, "new:b:1"), "A", fieldHadDraft = true))
    }

    @Test fun `text put in before any draft loaded goes after the saved one`() {
        assertEquals("Saved\n\nTaken back", loadedText("Saved\n", "Taken back", fieldHadDraft = false))
        assertEquals("Saved", loadedText("Saved", " Saved ", fieldHadDraft = false))
        assertNull(loadedText("", "Typed", fieldHadDraft = false))
    }

    @Test fun `another draft's text gives way to this one's, even when it's empty`() {
        assertEquals("", loadedText("", "The other thread's", fieldHadDraft = true))
    }
}
