package dev.relay.android.features.thread

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import dev.relay.android.features.thread.logic.shownWorkspaceMoves
import dev.relay.android.features.thread.logic.workspaceMoveLine
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.model.WorkspaceMove

/**
 * Where the thread moved under message [messageId], said on one line as the
 * desktop's MessageNotes does: "Claude moved this thread into its own worktree on relay/…".
 */
@Composable
fun WorkspaceMoveLine(moves: List<WorkspaceMove>?, messageId: String) {
    if (moves.isNullOrEmpty()) return
    val remote = LocalThreadRemote.current ?: return
    if ((remote.overview.collectAsState().value?.bridge ?: 1) < Bridge.WORKSPACE_MOVES) return
    val here = remember(moves, messageId) { shownWorkspaceMoves(moves).filter { it.after == messageId } }
    if (here.isNotEmpty()) StatusRow(here.joinToString(" · ", transform = ::workspaceMoveLine))
}
