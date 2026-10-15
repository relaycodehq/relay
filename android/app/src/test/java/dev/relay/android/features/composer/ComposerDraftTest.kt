package dev.relay.android.features.composer

import dev.relay.android.remote.drafts.DraftStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ComposerDraftTest {
    private val pc = "computer-1"

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
