package dev.relay.android.features.git

import dev.relay.android.remote.model.BranchList
import dev.relay.android.remote.model.BranchRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// iOS mirrors these in BranchMovesTests.swift.
class BranchMovesTest {
    private val main = BranchRef("main", "refs/heads/main", current = true)
    private val panel = BranchRef("panel", "refs/heads/panel", worktree = true)
    private val plain = BranchRef("plain", "refs/heads/plain")
    private val remotePanel = BranchRef("origin/panel", "refs/remotes/origin/panel", remote = true, local = "panel")
    private val remoteOnly = BranchRef("origin/shared", "refs/remotes/origin/shared", remote = true)
    private val list = BranchList("main", "abc", listOf(main, panel, plain, remotePanel, remoteOnly))

    @Test
    fun aProjectFolderThreadSwitchesTheFolderToAFreeBranchAndMovesForOneCheckedOutElsewhere() {
        assertEquals(BranchMove.Stay, branchMove(list, main, "main", inWorktree = false))
        assertEquals(BranchMove.SwitchProjectFolder, branchMove(list, plain, "main", inWorktree = false))
        assertEquals(BranchMove.MoveThread, branchMove(list, panel, "main", inWorktree = false))
        // A remote branch means its local twin, which a worktree has.
        assertEquals(BranchMove.MoveThread, branchMove(list, remotePanel, "main", inWorktree = false))
        assertEquals(BranchMove.SwitchProjectFolder, branchMove(list, remoteOnly, "main", inWorktree = false))
    }

    @Test
    fun aWorktreeThreadMovesForAnyBranchButItsOwn() {
        assertEquals(BranchMove.Stay, branchMove(list, panel, "panel", inWorktree = true))
        assertEquals(BranchMove.Stay, branchMove(list, remotePanel, "panel", inWorktree = true))
        assertEquals(BranchMove.MoveThread, branchMove(list, main, "panel", inWorktree = true))
        assertEquals(BranchMove.MoveThread, branchMove(list, remoteOnly, "panel", inWorktree = true))
    }

    @Test
    fun aRemoteBranchFromAnOlderDesktopNamesItsLocalTwinAfterTheRemote() {
        assertEquals("shared", localTwinName(remoteOnly))
        assertEquals("feature/x", localTwinName(BranchRef("origin/feature/x", "r", remote = true)))
    }

    @Test
    fun theAskSaysWhereTheThreadGoes() {
        assertEquals(
            BranchMoveAsk(
                "Switch to plain?",
                "Switches the project folder. If it can't, this thread gets a worktree of its own on plain.",
                "Switch",
            ),
            branchMoveAsk(BranchMove.SwitchProjectFolder, "plain"),
        )
        assertEquals(
            BranchMoveAsk(
                "Work on panel?",
                "This thread moves to the folder panel is checked out in, or to a worktree of its own on it.",
                "Move",
            ),
            branchMoveAsk(BranchMove.MoveThread, "panel"),
        )
    }

    @Test
    fun aRowSaysWhoseBranchItIs() {
        assertEquals("This thread's branch", branchRowNote(panel, "panel"))
        assertEquals("Checked out", branchRowNote(main, "panel"))
        assertEquals("Checked out in a worktree", branchRowNote(panel, null))
        assertNull(branchRowNote(plain, "main"))
    }
}
