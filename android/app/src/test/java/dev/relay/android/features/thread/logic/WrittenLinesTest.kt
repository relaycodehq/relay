package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.WrittenCode
import dev.relay.android.remote.model.WrittenEdit
import org.junit.Assert.assertEquals
import org.junit.Test

class WrittenLinesTest {
    private fun marks(view: WrittenView) = view.lines.map { "${it.mark.name[0]} ${it.text}" }

    @Test
    fun anEditTintsOnlyTheLinesItChanged() {
        val edit = WrittenEdit(old = "a\nb\nc\nd", new = "a\nB\nB2\nc\nd")
        val view = writtenView(WrittenCode("swap", "x.ts", edits = listOf(edit)))
        assertEquals(listOf("S a", "R b", "A B", "A B2", "S c", "S d"), marks(view))
        assertEquals(2, view.added)
        assertEquals(1, view.removed)
    }

    @Test
    fun linesPointIntoTheTextTheyCameFrom() {
        val edits = listOf(WrittenEdit("one\ntwo", "one\n2"), WrittenEdit("x", "y"))
        val view = writtenView(WrittenCode("swap", "x.ts", edits = edits))
        val before = view.before.split("\n")
        val after = view.after.split("\n")
        for (line in view.lines) assertEquals(line.text, (if (line.before) before else after)[line.index])
    }

    @Test
    fun aPatchReadsByItsMarks() {
        val diff = "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n"
        val view = writtenView(WrittenCode("patch", "x.ts", diff = diff))
        assertEquals(listOf("H @@ -1,2 +1,2 @@", "S keep", "R old", "A new"), marks(view))
    }

    @Test
    fun aPatchWithoutHunksIsTheWholeFile() {
        val view = writtenView(WrittenCode("patch", "x.ts", diff = "-not a mark\nline\n"))
        assertEquals(listOf("S -not a mark", "S line"), marks(view))
    }
}
