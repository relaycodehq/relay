package dev.relay.android.lib.navigation

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/**
 * Every screen the phone can show. The back stack is a list of these and is
 * saved across process death, so a route holds ids and small strings only.
 * `where` is a project id or a worktree path, as the bridge takes it.
 */
@Serializable
sealed interface Route : NavKey {
    @Serializable data object Home : Route

    /** `link` is the whole `relay-remote://pair?...` URL, or null to scan one. */
    @Serializable data class Pair(val link: String? = null) : Route

    @Serializable data class NewThread(
        val projectId: String? = null,
        val scratch: Boolean = false,
        val draftKey: String? = null,
    ) : Route

    @Serializable data object Settings : Route
    @Serializable data object Gallery : Route
    @Serializable data object Licences : Route

    @Serializable data class Thread(val id: String) : Route
    @Serializable data class Reply(val id: String, val rootId: String) : Route
    @Serializable data class SubagentRun(val chatId: String, val agentId: String, val rootId: String? = null) : Route
    @Serializable data class Project(val id: String) : Route
    @Serializable data class Turn(val chatId: String, val messageId: String? = null, val worktree: String? = null) : Route

    /** `source` is a RemoteDiffSource as JSON, kept opaque here. */
    @Serializable data class Diff(val source: String) : Route

    @Serializable data class Changes(val where: String) : Route
    @Serializable data class Branches(val where: String) : Route
    @Serializable data class Commit(val where: String, val sha: String) : Route
    @Serializable data class Files(val where: String, val dir: String? = null) : Route
    @Serializable data class File(val where: String, val path: String) : Route
    @Serializable data class History(val where: String) : Route
    @Serializable data class Tasks(val where: String) : Route

    /** A browser on the computer's localhost, through the tunnel: `url` an http://localhost link, null for the sites. */
    @Serializable data class Browser(val url: String? = null) : Route
}
