package dev.relay.android.features.git

import dev.relay.android.remote.model.DiffHunk
import dev.relay.android.remote.model.DiffLine
import dev.relay.android.remote.model.RemoteDiff
import org.junit.Assert.assertEquals
import org.junit.Test

// The cases of tests/unit/phone-split-diff.test.ts.
class SplitDiffTest {
    private fun same(n: Int, text: String) = DiffLine("same", text, old = n, new = n)
    private fun del(old: Int, text: String) = DiffLine("del", text, old = old)
    private fun add(n: Int, text: String) = DiffLine("add", text, new = n)

    private fun sides(lines: List<DiffLine>): List<Any> =
        splitRows(RemoteDiff("a.ts", false, listOf(DiffHunk("@@ -1 +1 @@", lines)), false)).map {
            when (it) {
                is SplitRow.Hunk -> it.header
                is SplitRow.Pair -> listOf(it.left?.text, it.right?.text)
            }
        }

    @Test
    fun setsEachRemovedLineAgainstTheOneThatReplacedIt() {
        assertEquals(
            listOf("@@ -1 +1 @@", listOf("a", "a"), listOf("b", "B"), listOf("c", null), listOf("d", "d"), listOf(null, "e")),
            sides(listOf(same(1, "a"), del(2, "b"), del(3, "c"), add(2, "B"), same(4, "d"), add(4, "e"))),
        )
    }

    @Test
    fun doesNotPairARemovalWithAdditionsThatCameBeforeIt() {
        assertEquals(
            listOf("@@ -1 +1 @@", listOf(null, "new"), listOf("old", null)),
            sides(listOf(add(1, "new"), del(1, "old"))),
        )
    }
}
