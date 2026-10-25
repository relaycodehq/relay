package dev.relay.android.remote.model

import kotlinx.serialization.Serializable

// Pull requests as the desktop's host clients answer them (shared/types.ts): GitHub, Gitea
// and Azure DevOps all come back in GitHub's shape.

@Serializable data class HostUser(val login: String = "", val id: Long = 0)

@Serializable data class HostAccount(val server: String, val user: HostUser)

@Serializable data class PullRef(val owner: String, val name: String, val number: Int, val server: String? = null)

@Serializable data class IssueRepo(val name: String, val owner: String, val server: String? = null)

@Serializable data class PullLabel(val name: String, val color: String = "")

@Serializable data class PullMerged(val merged: Boolean = false)

/** A search hit: a PR (or issue) you're part of. */
@Serializable
data class IssueHit(
    val number: Int,
    val title: String,
    val state: String,
    val html_url: String = "",
    val updated_at: String = "",
    val user: HostUser = HostUser(),
    val repository: IssueRepo,
    val labels: List<PullLabel> = emptyList(),
    val comments: Int = 0,
    val pull_request: PullMerged? = null,
    val draft: Boolean? = null,
)

@Serializable data class HostPage<T>(val items: List<T>, val nextPage: Int? = null, val total: Int? = null)

@Serializable data class PullBranch(val ref: String, val sha: String = "")

@Serializable
data class PullDetail(
    val owner: String,
    val name: String,
    val number: Int,
    val server: String? = null,
    val title: String,
    val body: String? = null,
    val state: String,
    val draft: Boolean = false,
    val merged: Boolean = false,
    val html_url: String = "",
    val head: PullBranch,
    val base: PullBranch,
    val user: HostUser = HostUser(),
    val additions: Int = 0,
    val deletions: Int = 0,
    val changed_files: Int = 0,
    val updated_at: String = "",
    val labels: List<PullLabel> = emptyList(),
    val comments: Int = 0,
)

@Serializable
data class PullFile(
    val filename: String,
    val previous_filename: String? = null,
    val status: String = "",
    val additions: Int = 0,
    val deletions: Int = 0,
)

@Serializable
data class PullReview(
    val id: Long,
    val body: String = "",
    val state: String,
    val user: HostUser = HostUser(),
    val submitted_at: String = "",
    val dismissed: Boolean? = null,
    val stale: Boolean? = null,
)

@Serializable
data class PullComment(
    val id: Long,
    val body: String = "",
    val user: HostUser = HostUser(),
    val created_at: String = "",
    val html_url: String = "",
)
