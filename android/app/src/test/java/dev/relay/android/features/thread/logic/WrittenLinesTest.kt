package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.WrittenCode
import dev.relay.android.remote.model.WrittenEdit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
    fun aPatchsHeadersEndAtItsFirstHunk() {
        val diff = "diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- old rule\n+++ new rule\n"
        val view = writtenView(WrittenCode("patch", "x.md", diff = diff))
        assertEquals(listOf("H @@ -1 +1 @@", "R -- old rule", "A ++ new rule"), marks(view))
    }

    @Test
    fun aFileCutBeforeAnyOfItFitKeptNothing() {
        assertTrue(keptNothing(WrittenCode("whole", "x.ts", content = "", cut = true)))
        assertTrue(keptNothing(WrittenCode("swap", "x.ts", edits = listOf(WrittenEdit("", "")), cut = true)))
        assertFalse(keptNothing(WrittenCode("patch", "x.ts", diff = "@@ -1 +1 @@", cut = true)))
        assertFalse(keptNothing(WrittenCode("whole", "x.ts", content = "")))
    }

    @Test
    fun aPatchsOldAndNewCodeHighlightApart() {
        val view = writtenView(WrittenCode("patch", "x.ts", diff = "@@ -1,2 +1,2 @@\n keep\n-old\n+new\n"))
        assertEquals("keep\nold", view.before)
        assertEquals("keep\nnew", view.after)
        for (line in view.lines.filter { it.mark != LineMark.Hunk })
            assertEquals(line.text, (if (line.before) view.before else view.after).split("\n")[line.index])
    }

    @Test
    fun aNewlineEndingAnEditStartsNoLine() {
        val view = writtenView(WrittenCode("swap", "x.ts", edits = listOf(WrittenEdit("a\n", "b\n"))))
        assertEquals(listOf("R a", "A b"), marks(view))
    }

    @Test
    fun aPatchWithoutHunksIsTheWholeFile() {
        val view = writtenView(WrittenCode("patch", "x.ts", diff = "-not a mark\nline\n"))
        assertEquals(listOf("S -not a mark", "S line"), marks(view))
    }
}
