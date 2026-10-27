package dev.relay.android.remote.model

import kotlinx.serialization.Serializable

// What the desktop's Git, file and task calls answer (shared/working-tree.ts,
// branches.ts, branch-merge.ts, history.ts, ci.ts, tasks.ts, projects/worktrees.ts).
// Enum-like fields stay strings so newer values decode.

@Serializable
data class WorkingChange(
    val path: String,
    val previousPath: String? = null,
    /** Porcelain status letters: " ", "M", "A", "D", "R", "?" … */
    val index: String,
    val worktree: String,
    val conflict: Boolean = false,
)

@Serializable data class LineCounts(val additions: Int = 0, val deletions: Int = 0)
@Serializable data class GitCommit(val sha: String, val subject: String)

@Serializable
data class WorkingTree(
    val head: String = "",
    val branch: String = "",
    val revision: String,
    val changes: List<WorkingChange> = emptyList(),
    val upstream: String? = null,
    val ahead: Int = 0,
    val behind: Int = 0,
    val pushTarget: String? = null,
    val pushUrl: String? = null,
    val pushRetracks: Boolean? = null,
    val operation: String? = null,
    val lines: LineCounts = LineCounts(),
    val outgoing: List<GitCommit> = emptyList(),
)

/**
 * `gitActionSchema`, strict on the desktop: unset fields stay null and are
 * left out. kind: stage | unstage | commit | push | pull | fetch.
 */
@Serializable
data class GitAction(
    val kind: String,
    val revision: String? = null,
    val paths: List<String>? = null,
    val message: String? = null,
) {
    companion object {
        fun stage(revision: String, paths: List<String>) = GitAction("stage", revision, paths)
        fun unstage(revision: String, paths: List<String>) = GitAction("unstage", revision, paths)
        fun commit(revision: String, message: String, paths: List<String>?) = GitAction("commit", revision, paths, message)
        fun push(revision: String) = GitAction("push", revision)
        fun pull(revision: String) = GitAction("pull", revision)
        val fetch = GitAction("fetch")
    }
}

@Serializable
data class BranchRef(
    val name: String,
    val ref: String,
    val current: Boolean = false,
    val remote: Boolean = false,
    /** For a remote branch: the local one checking it out would make; older desktops leave it out. */
    val local: String? = null,
    val worktree: Boolean = false,
    val unrelated: Boolean = false,
)

@Serializable
data class BranchList(
    val current: String,
    val head: String,
    val branches: List<BranchRef> = emptyList(),
    val bases: List<String> = emptyList(),
)

/** kind: "switch" | "create". */
@Serializable data class BranchAction(val kind: String, val name: String, val current: String, val head: String)

/** kind: "head" | "branch" | "remote" | "tag". */
@Serializable data class CommitRef(val name: String, val kind: String)

@Serializable
data class CommitSummary(
    val sha: String,
    val parents: List<String> = emptyList(),
    val author: String,
    /** Unix seconds. */
    val time: Long,
    val refs: List<CommitRef> = emptyList(),
    val subject: String,
)

@Serializable data class CommitLog(val commits: List<CommitSummary>, val more: Boolean = false)

@Serializable
data class CommitFileChange(
    val path: String,
    val previousPath: String? = null,
    /** "A" | "M" | "D" | "R" | "C" | "T" */
    val status: String,
    val additions: Int = 0,
    val deletions: Int = 0,
    val binary: Boolean = false,
)

@Serializable
data class CommitDetail(
    val sha: String,
    val parents: List<String> = emptyList(),
    val author: String,
    val email: String = "",
    val time: Long,
    val refs: List<CommitRef> = emptyList(),
    val subject: String,
    val body: String = "",
    val files: List<CommitFileChange> = emptyList(),
)

@Serializable
data class MergePlan(
    val branch: String,
    val head: String,
    val base: String,
    val baseHead: String,
    val bases: List<String> = emptyList(),
    val commits: List<GitCommit> = emptyList(),
    val fastForward: Boolean = false,
    val pushTarget: String? = null,
    val checkedOutAt: String? = null,
    val snapshots: Int = 0,
    val uncommitted: Int = 0,
)

@Serializable
data class MergeBranch(val branch: String, val head: String, val base: String, val baseHead: String, val push: Boolean)

/** Merged, or `merged == false` with the files that conflict. */
@Serializable
data class MergeResult(
    val merged: Boolean,
    val base: String? = null,
    val sha: String? = null,
    val fastForward: Boolean = false,
    val pushedTo: String? = null,
    val conflicts: List<String> = emptyList(),
)

/** by: "merge" | "pr". */
@Serializable data class WorktreeLanded(val by: String)

@Serializable
data class WorktreeStatus(
    val branch: String? = null,
    val path: String? = null,
    val from: String? = null,
    val files: List<TurnFileChange> = emptyList(),
    val landed: WorktreeLanded? = null,
    val removed: Boolean = false,
)

@Serializable data class RewindResult(val conflicts: List<String> = emptyList())

@Serializable
data class LocalFile(
    val path: String,
    val branch: String = "",
    val head: String = "",
    val contents: String,
)

@Serializable
data class ProjectTask(
    val id: String,
    val command: String,
    val kind: String = "",
    val title: String,
    val agent: String? = null,
    /** "relay" | "terminal" | "external" | "detached" */
    val origin: String,
    val chatId: String? = null,
    val worktree: String? = null,
    val folder: String? = null,
    val started: Long,
    val ports: List<Int> = emptyList(),
    val pids: Int = 0,
)

/** state: "success" | "failure" | "running" | "skipped". */
@Serializable
data class CiRun(val workflow: String, val state: String, val failedJob: String? = null, val url: String, val at: Long)

@Serializable data class CiCommit(val sha: String, val message: String? = null, val author: String? = null)

@Serializable
data class CiStatus(
    val source: String = "",
    val branch: String,
    val commit: CiCommit,
    val runs: List<CiRun> = emptyList(),
    val ahead: Int = 0,
)
