package dev.relay.android.features.git

import dev.relay.android.remote.model.CiRun
import dev.relay.android.remote.model.WorkingChange
import dev.relay.android.remote.model.WorkingTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GitTextTest {
    private fun run(state: String, at: Long) = CiRun("w$at", state, url = "u$at", at = at)

    @Test
    fun aFailureOutranksALaterPassAndARunStillGoing() {
        val failed = run("failure", 1)
        val summary = ciSummary(listOf(failed, run("success", 3), run("running", 2)))
        assertEquals("failure", summary?.state)
        assertEquals(failed, summary?.target)
    }

    @Test
    fun aPassOpensTheLatestRunAndSkippedRunsDecideNothing() {
        val latest = run("success", 5)
        assertEquals(CiSummary("success", latest), ciSummary(listOf(run("success", 1), latest, run("skipped", 9))))
        assertNull(ciSummary(listOf(run("skipped", 1))))
    }

    private fun change(path: String, index: String, worktree: String, conflict: Boolean = false) =
        WorkingChange(path, index = index, worktree = worktree, conflict = conflict)

    private val tree = WorkingTree(branch = "main", revision = "r", upstream = "origin/main", pushTarget = "origin/main")

    @Test
    fun commitTakesEveryFileButConflictsAndSaysWhereItPushes() {
        val t = tree.copy(changes = listOf(change("a", "M", " "), change("b", "?", "?")))
        assertEquals(listOf("a", "b"), everyPath(t))
        assertEquals("2 files, then push to origin/main", commitHint(t))
        assertEquals("1 file on main · no remote to push to", commitHint(t.copy(pushTarget = null, changes = t.changes.take(1))))
    }

    @Test
    fun anOperationOrAConflictOrADetachedHeadBlocksTheCommit() {
        assertEquals("Finish the rebase on your computer first.", blocker(tree.copy(operation = "rebase-merge")))
        assertEquals("Resolve the conflicts on your computer first.", blocker(tree.copy(changes = listOf(change("a", "U", "U", true)))))
        assertEquals("Check out a branch on your computer to commit.", blocker(tree.copy(branch = "")))
        assertNull(blocker(tree))
    }

    @Test
    fun stagedAndUnstagedFollowThePorcelainLetters() {
        assertEquals(listOf(true, false), change("a", "M", " ").let { listOf(it.staged, it.unstaged) })
        assertEquals(listOf(false, true), change("a", "?", "?").let { listOf(it.staged, it.unstaged) })
        assertEquals(listOf(true, true), change("a", "A", "M").let { listOf(it.staged, it.unstaged) })
    }

    @Test
    fun pushIsOffWhenTheUpstreamHasEverything() {
        assertEquals(false, canPush(tree, busy = false))
        assertEquals(true, canPush(tree.copy(ahead = 1), busy = false))
        // No upstream yet: the first push sets it.
        assertEquals(true, canPush(tree.copy(upstream = null), busy = false))
        assertEquals("1 to push · 2 to pull · origin/main", remoteLine(tree.copy(ahead = 1, behind = 2)))
    }
}
