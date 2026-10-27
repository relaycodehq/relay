package dev.relay.android.features.git

import dev.relay.android.remote.model.BranchList
import dev.relay.android.remote.model.BranchRef

/** What picking a branch in a started thread's branch list does; the desktop's StartedThreadBranch. */
enum class BranchMove {
    /** The thread is on it already. */
    Stay,

    /** Switch the project folder to it; if it can't, the thread moves instead. */
    SwitchProjectFolder,

    /** Move the thread to wherever it's worked on (`projectChatWorkOn`). */
    MoveThread,
}

/** A remote branch's local one, as `git switch` makes it: `shared/branches.ts` localTwinName. */
fun localTwinName(b: BranchRef) = b.local ?: b.name.substringAfter('/')

/**
 * Picking [picked] means working on it, wherever that is: the project
 * folder's branch or one it can switch to, else where it's checked out or a
 * worktree on it. A thread in its own worktree always moves.
 */
fun branchMove(list: BranchList, picked: BranchRef, threadBranch: String?, inWorktree: Boolean): BranchMove {
    val twin = if (picked.remote) list.branches.find { !it.remote && it.name == localTwinName(picked) } else null
    val own = twin ?: picked
    val name = if (picked.remote && twin == null) localTwinName(picked) else own.name
    if (inWorktree) return if (name == threadBranch) BranchMove.Stay else BranchMove.MoveThread
    if (own.current) return BranchMove.Stay
    if (own.worktree) return BranchMove.MoveThread
    return BranchMove.SwitchProjectFolder
}

/** What the confirmation before a move asks. */
data class BranchMoveAsk(val title: String, val message: String, val action: String)

fun branchMoveAsk(move: BranchMove, name: String) = when (move) {
    BranchMove.SwitchProjectFolder -> BranchMoveAsk(
        "Switch to $name?",
        "Switches the project folder. If it can't, this thread gets a worktree of its own on $name.",
        "Switch",
    )
    else -> BranchMoveAsk(
        "Work on $name?",
        "This thread moves to the folder $name is checked out in, or to a worktree of its own on it.",
        "Move",
    )
}

/** Under a branch's name in the list; [threadBranch] is the open thread's, when there is one. */
fun branchRowNote(b: BranchRef, threadBranch: String?): String? = when {
    threadBranch != null && b.name == threadBranch -> "This thread's branch"
    b.current -> "Checked out"
    b.worktree -> "Checked out in a worktree"
    else -> null
}
