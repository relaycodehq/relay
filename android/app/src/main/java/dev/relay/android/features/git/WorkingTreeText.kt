package dev.relay.android.features.git

import dev.relay.android.remote.model.WorkingChange
import dev.relay.android.remote.model.WorkingTree

// shared/working-tree.ts and the rules of mobile/src/app/changes.tsx.

/** The most files one commit takes, as on the desktop. */
const val MAX_COMMIT_FILES = 1000
const val MAX_COMMIT_MESSAGE = 16000

/** Has a diff between HEAD and the index; untracked files don't. */
val WorkingChange.staged: Boolean get() = index != " " && index != "?"

/** Has a diff between the index and the file on disk, or is in conflict. */
val WorkingChange.unstaged: Boolean get() = worktree != " " || conflict

enum class ChangeKind { Added, Deleted, Modified, Conflict }

/** Porcelain status letter → how the file name is coloured. */
fun changeKind(code: String, conflict: Boolean = false): ChangeKind = when {
    conflict -> ChangeKind.Conflict
    code == "A" || code == "?" -> ChangeKind.Added
    code == "D" -> ChangeKind.Deleted
    else -> ChangeKind.Modified
}

private val operationNames = mapOf(
    "MERGE_HEAD" to "merge",
    "CHERRY_PICK_HEAD" to "cherry-pick",
    "REVERT_HEAD" to "revert",
    "rebase-merge" to "rebase",
    "rebase-apply" to "rebase",
)

/** The Git operation under way as people say it: `MERGE_HEAD` is a "merge". */
fun operationName(operation: String) = operationNames[operation] ?: operation

/** "Merge in progress". */
fun operationInProgress(operation: String) = operationName(operation).replaceFirstChar { it.uppercase() } + " in progress"

/** What Commit & push takes: every changed file, staged or not, as the desktop's commit sheet picks by default. */
fun everyPath(tree: WorkingTree): List<String> = tree.changes.filter { !it.conflict }.map { it.path }

/** Why nothing can be committed right now, when something stands in the way. */
fun blocker(tree: WorkingTree): String? = when {
    tree.operation != null -> "Finish the ${operationName(tree.operation)} on your computer first."
    tree.changes.any { it.conflict } -> "Resolve the conflicts on your computer first."
    tree.branch.isEmpty() -> "Check out a branch on your computer to commit."
    else -> null
}

/** The line above the commit message: what's in the way, or what Commit & push will do. */
fun commitHint(tree: WorkingTree): String {
    blocker(tree)?.let { return it }
    val all = everyPath(tree).size
    val count = plural(all, "file")
    return when {
        all > MAX_COMMIT_FILES -> "Over $MAX_COMMIT_FILES files. Stage a part and commit that."
        tree.pushTarget != null -> "$count, then push to ${tree.pushTarget}"
        else -> "$count on ${tree.branch} · no remote to push to"
    }
}

/** Where Push goes: the push target, else the upstream. */
fun pushTo(tree: WorkingTree): String? = tree.pushTarget ?: tree.upstream

/** The Remote section's line: what's to push and pull, and where. */
fun remoteLine(tree: WorkingTree): String {
    val to = pushTo(tree) ?: return "This branch has no remote yet."
    val push = if (tree.ahead > 0) "${tree.ahead} to push" else "Nothing to push"
    val pull = if (tree.behind > 0) " · ${tree.behind} to pull" else ""
    return "$push$pull · $to"
}

/** Push shows exactly where and what before it goes, as on the desktop. */
fun pushQuestion(tree: WorkingTree): Pair<String, String> {
    val n = tree.outgoing.size
    val title = if (n > 0) "Push $n commit${if (n == 1) "" else "s"}?" else "Push the branch?"
    return title to "To ${pushTo(tree) ?: "origin/${tree.branch}"}. A normal push, never forced."
}

fun canPush(tree: WorkingTree, busy: Boolean): Boolean =
    !busy && tree.branch.isNotEmpty() && pushTo(tree) != null && !(tree.upstream != null && tree.ahead == 0)
