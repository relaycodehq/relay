package dev.relay.android.features.thread.logic

import dev.relay.android.remote.delta.applyChatPatch
import dev.relay.android.remote.model.WorkspaceMove
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

// Cases from shared/workspace-moves.test.ts, and the lines the desktop writes under them.
class WorkspaceMovesTest {
    private fun move(at: Long, after: String?, to: String? = null, how: String = "switched") =
        WorkspaceMove(at, after, how, to, unasked = true)

    private fun shown(vararg moves: WorkspaceMove) = shownWorkspaceMoves(moves.toList()).map { it.at }

    @Test fun showsWhereTheThreadEndedUpUnderEachMessage() {
        assertEquals(emptyList<Long>(), shown(move(1, "ask", "/wt/scratch"), move(2, "ask")))
        assertEquals(listOf(2L), shown(move(1, "ask", "/wt/a"), move(2, "ask", "/wt/b")))
        assertEquals(listOf(1L, 2L), shown(move(1, "ask", "/wt/a"), move(2, "answer")))
        assertEquals(listOf(1L, 2L), shown(move(1, "ask", "/wt/a"), move(2, "later", "/wt/a", "recreated")))
        // One made before the thread had a message names none; it still ends.
        assertEquals(listOf(1L), shown(move(1, null, "/wt/a", "recreated")))
    }

    @Test fun saysWhoMovedItAndWhere() {
        val moved = WorkspaceMove(1, "m", "moved", "/w/relay-x", branch = "relay/x", unasked = true, by = "claude")
        assertEquals("Claude moved this thread into its own worktree on relay/x", workspaceMoveLine(moved))
        assertEquals("Moved this thread into its own worktree on relay-x", workspaceMoveLine(moved.copy(unasked = null, by = null, branch = null)))
        assertEquals("New worktree on relay/x", workspaceMoveLine(moved.copy(how = "recreated", fresh = true)))
        assertEquals("Now working in relay/x, a worktree Claude made", workspaceMoveLine(moved.copy(how = "switched")))
        assertEquals(
            "Back in the project folder; the worktree the agent made is gone",
            workspaceMoveLine(WorkspaceMove(2, "m", "switched", unasked = true)),
        )
        assertEquals("Switched to the project folder", workspaceMoveLine(WorkspaceMove(2, "m", "switched")))
    }

    @Test fun readsTheMovesInTheThreadADesktopSends() {
        val patch = Json.parseToJsonElement(
            """{"id":"c","projectId":"p","title":"T","scope":{"kind":"project"},"messages":[],"running":false,"earlier":0,
               "queue":[],"scheduled":[],"workspaceMoves":[{"at":5,"after":"m1","how":"moved","to":"/w/x","branch":"relay/x","unasked":true,"by":"codex"}]}""",
        ).jsonObject
        assertEquals(
            listOf(WorkspaceMove(5, "m1", "moved", "/w/x", branch = "relay/x", unasked = true, by = "codex")),
            applyChatPatch(patch, null).workspaceMoves,
        )
    }
}
