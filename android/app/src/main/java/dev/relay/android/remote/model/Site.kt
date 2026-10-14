package dev.relay.android.remote.model

import kotlinx.serialization.Serializable

/** A dev server the phone can open through the tunnel: a project's task listening on [port]. */
@Serializable
data class RemoteSite(
    val port: Int,
    /** What it is, e.g. "Vite dev server". */
    val title: String,
    val command: String,
    val projectId: String,
    val project: String,
    val chatId: String? = null,
    /** Runs in a thread's worktree rather than the project's checkout. */
    val worktree: Boolean = false,
)
