package dev.relay.android.features.notes

import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.ThreadNote
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Cases from shared/thread-notes.test.ts, so a phone quotes and ticks what the desktop would.
class NoteListsTest {
    private fun note(text: String, done: List<Int>? = null) = ThreadNote("n1", text, done = done, created = 1, updated = 1)

    @Test fun quotesOnlyUnfinishedItems() {
        val text = "Next:\n\n1. Already fixed\n2. Still needed\n3. Also fixed\n4. Last job"
        assertEquals("Next:\n\n2. Still needed\n\n4. Last job", noteQuote(note(text, listOf(0, 2))))
        assertEquals("", noteQuote(note(text, listOf(0, 1, 2, 3))))
        assertEquals("", noteQuote(note(text, listOf(0)), 0))
        assertEquals("2. Still needed", noteQuote(note(text, listOf(0)), 1))
        assertEquals("", noteQuote(note(text), 9))
    }

    @Test fun keepsNestedListsParagraphsAndCode() {
        val text = "Jobs:\n\n9. Finished\n10. **Remaining**\n    - child\n\n    More context.\n\n    ```ts\n    run()\n    ```"
        val expected = "10. **Remaining**\n    - child\n\n    More context.\n\n    ```ts\n    run()\n    ```"
        assertEquals("Jobs:\n\n$expected", noteQuote(note(text, listOf(0))))
        assertEquals(expected, noteQuote(note(text), 1))
        assertEquals("- remaining\n  - child", noteQuote(note("- done\n- remaining\n  - child", listOf(0))))
    }

    @Test fun leavesPlainNotesAndUntouchedListsWhole() {
        for (text in listOf("A **decision**", "```ts\nrun()\n```", "Ideas:\n\n* a\n* b")) {
            assertEquals(text, noteQuote(note(text)))
            assertEquals(text, noteQuote(note(text, listOf(99))))
        }
        // A pinned answer quotes its label, and never an item.
        val pin = ThreadNote("n2", "Fix the cache first.", from = "m1", ref = true, created = 1, updated = 1)
        assertEquals("Fix the cache first.", noteQuote(pin))
        assertEquals("", noteQuote(pin, 0))
    }

    @Test fun readsAListWithItsLead() {
        assertEquals(
            NoteList("Ideas, cheapest first:", listOf(NoteItem("1.", "Cache **threads**"), NoteItem("2.", "Skip the heartbeat"))),
            noteList("Ideas, cheapest first:\n\n1. Cache **threads**\n2. Skip the heartbeat"),
        )
        assertEquals(listOf("", ""), noteList("- a\n- b")?.items?.map { it.number })
        assertEquals(
            listOf(NoteItem("3.", "Outbox\n- retry after 30 s\n\n```ts\nsend()\n```"), NoteItem("4.", "Images")),
            noteList("3. Outbox\n   - retry after 30 s\n\n   ```ts\n   send()\n   ```\n4. Images")?.items,
        )
    }

    @Test fun leavesNotesThatArentOnlyAListAsText() {
        assertNull(noteList("Just a thought"))
        assertEquals(listOf(NoteItem("", "only one")), noteList("- only one")?.items)
        assertNull(noteList("- a\n- b\n\nAnd then prose after it."))
        assertNull(noteList("```\n- a\n- b\n```"))
    }

    @Test fun ticksHereAsTheComputerWould() {
        val notes = listOf(note("- a\n- b\n- c", listOf(2)), note("other").copy(id = "n2"))
        assertEquals(listOf(0, 2), ticked(notes, "n1", 0, true)[0].done)
        assertNull(ticked(listOf(note("- a", listOf(0))), "n1", 0, false)[0].done)
        assertEquals(notes[1], ticked(notes, "n1", 1, true)[1])
    }

    // The desktop's mark for the same notes, so a tick's own answer doesn't fetch them again.
    @Test fun marksNotesAsTheSummaryDoes() {
        assertNull(notesMark(emptyList()))
        assertEquals("2.40", notesMark(listOf(note("a").copy(updated = 40), note("b").copy(id = "n2", updated = 7))))
        val wire = """[{"id":"n1","text":"- a","done":[0],"by":"claude","created":1,"updated":2,"extra":true}]"""
        val decoded = RemoteJson.decodeFromString<List<ThreadNote>>(wire).single()
        assertEquals(listOf(0), decoded.done)
        assertEquals("claude", decoded.by)
    }
}
