package dev.relay.android.features.thread.logic

// shared/workspace-moves.ts: the line a thread's move leaves under the message it happened after.

import dev.relay.android.remote.model.WorkspaceMove

private fun folderName(path: String) = path.split('/', '\\').last().ifEmpty { path }

fun workspaceMoveLine(move: WorkspaceMove): String {
    val to = move.to?.takeIf { it.isNotEmpty() }
    val where = move.branch ?: to?.let(::folderName)
    val on = where?.let { " on $it" }.orEmpty()
    val agent = move.by?.let(::agentName) ?: "the agent"
    val unasked = move.unasked == true
    return when {
        move.how == "recreated" -> "${if (move.fresh == true) "New worktree" else "Worktree made again"}$on"
        move.how == "moved" ->
            "${if (unasked) "${if (move.by != null) agent else "The agent"} moved" else "Moved"} this thread into its own worktree$on"
        to == null -> if (unasked) "Back in the project folder; the worktree $agent made is gone" else "Switched to the project folder"
        else -> if (unasked) "Now working in $where, a worktree $agent made" else "Switched to $where"
    }
}

/**
 * One line per spot in the thread: moves under the same message read as
 * where the thread ended up, and none when that's where it already was.
 */
fun shownWorkspaceMoves(moves: List<WorkspaceMove>?): List<WorkspaceMove> {
    val all = moves.orEmpty()
    val shown = ArrayList<WorkspaceMove>()
    var before: String? = null
    var i = 0
    while (i < all.size) {
        var end = i
        while (end + 1 < all.size && all[end + 1].after == all[i].after) end++
        val group = all.subList(i, end + 1)
        val last = group.last()
        if (last.to != before || group.any { it.how != "switched" }) shown += last
        before = last.to
        i = end + 1
    }
    return shown
}
