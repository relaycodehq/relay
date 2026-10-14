package dev.relay.android.features.git

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.client.projectWorktree
import dev.relay.android.remote.client.rewindProjectTurn
import dev.relay.android.remote.client.sendProjectChat
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.TurnFileChange
import dev.relay.android.remote.model.WorktreeStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

private val agentNames = mapOf(
    "codex" to "Codex", "claude" to "Claude", "opencode" to "OpenCode", "cursor" to "Cursor",
    "muse" to "Muse", "amp" to "Amp", "antigravity" to "Antigravity",
)

/** shared/agents.ts `agentName`; a registry agent shows its id. */
fun agentName(provider: String) = agentNames[provider] ?: provider

/** mobile/src/remote/links.ts `workspaceId`: a thread's worktree as the bridge names it. */
fun workspaceId(projectId: String, chatId: String? = null) = if (chatId != null) "$projectId/$chatId" else projectId

/** A turn's files grouped by folder, folders in order; "" is the top level. */
fun byFolder(files: List<TurnFileChange>): List<Pair<String, List<TurnFileChange>>> =
    files.groupBy { f -> f.path.lastIndexOf('/').let { if (it > 0) f.path.substring(0, it) else "" } }
        .toList()
        .sortedBy { it.first }

/** "Nothing was changed": who was edited after the turn or the rollback. */
fun rewindConflictText(conflicts: List<String>, mode: String): String {
    val who = if (conflicts.size == 1) "${conflicts[0].substringAfterLast('/')} was" else "${conflicts.size} files were"
    return "$who edited after ${if (mode == "revert") "this turn" else "the rollback"} in ways that overlap it."
}

/**
 * mobile/src/app/turn.tsx: one turn's changes from Relay's snapshots, or with
 * [worktree] what the thread's worktree has that its branch doesn't yet.
 */
class TurnModel(
    private val remote: Remote,
    val chatId: String,
    val messageId: String?,
    val worktree: Boolean,
) : ViewModel() {
    val thread = MutableStateFlow<RemoteChat?>(null)
    val threadError = MutableStateFlow<String?>(null)
    val status = MutableStateFlow<WorktreeStatus?>(null)
    val statusError = MutableStateFlow<String?>(null)
    /** The path being rolled back, or "all". */
    val busy = MutableStateFlow<String?>(null)
    val asks = Asks()

    init {
        viewModelScope.launch { remote.chat(chatId).collect { thread.value = it; threadError.value = null } }
    }

    suspend fun loadStatus() {
        if (!worktree) return
        try {
            status.value = remote.call { projectWorktree(chatId) }
            statusError.value = null
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            statusError.value = errorText(e)
        }
    }

    suspend fun reloadThread() {
        try {
            thread.value = remote.call { chat(chatId, thread.value) }
            threadError.value = null
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            threadError.value = errorText(e)
        }
    }

    fun rewind(paths: List<String>?, mode: String, force: Boolean = false) {
        val message = messageId ?: return
        busy.value = paths?.firstOrNull() ?: "all"
        viewModelScope.launch {
            try {
                val conflicts = remote.call { rewindProjectTurn(chatId, message, paths, mode, force) }.conflicts
                reloadThread()
                if (conflicts.isNotEmpty()) asks.confirm(
                    "Nothing was changed",
                    rewindConflictText(conflicts, mode),
                    "Overwrite anyway",
                    destructive = true,
                ) { rewind(paths, mode, force = true) }
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                asks.alert("Couldn't roll back", errorText(e))
            } finally {
                busy.value = null
            }
        }
    }

    /**
     * Sends the thread's agent [text] on the thread's own settings.
     * TODO: swap for the composer's composeSend (fastFor, windowFor, mentions)
     * and the outbox once features/composer has them; this sends directly.
     */
    suspend fun askAgent(text: String) {
        val settings = thread.value?.settings ?: throw IllegalStateException("This thread has no agent settings to send with yet.")
        val body = text.trim()
        val send = ProjectChatSend(
            id = UUID.randomUUID().toString(),
            body = "@${settings.provider} $body",
            choice = settings.choice,
            provider = settings.provider,
            runtimeMode = settings.runtimeMode,
            interactionMode = settings.interactionMode,
            contextWindow = settings.contextWindow,
            to = settings.provider,
        )
        remote.call { sendProjectChat(chatId, send) }
    }
}
