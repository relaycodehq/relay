package dev.relay.android.features.composer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.relay.android.features.composer.logic.conversationSettings
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.ResumeSettings

internal data class SentThreadSettings(val id: String, val settings: ResumeSettings)

/** Mirrored threads carry their settings on messages, without a local lastInput. */
internal fun lastThreadSettings(
    chat: RemoteChat?,
    listed: List<ChatMessage>,
    rootId: String?,
    holder: String?,
): SentThreadSettings? {
    val users = listed.filter {
        it.role == "user" && it.provider != "message" &&
            (rootId != null || it.side != true) &&
            (it.id != rootId || it.side == true)
    }
    users.lastOrNull { it.sentSettings != null }?.let {
        return SentThreadSettings(it.id, it.sentSettings!!)
    }
    val legacy = chat?.settings ?: return null
    return SentThreadSettings(
        users.lastOrNull()?.id ?: "legacy:${rootId.orEmpty()}",
        conversationSettings(legacy, chat.lastParentId, rootId, holder),
    )
}

/** Follows new sends while keeping picks made for the next message here. */
internal class ThreadSettings {
    var settings: ResumeSettings? by mutableStateOf(null)
        private set
    private var sent: SentThreadSettings? = null
    private var pickedBeforeHistory = false
    private val sentHere = HashSet<String>()

    fun follow(next: SentThreadSettings?) {
        if (next == null || next == sent) return
        val firstHistory = sent == null
        sent = next
        if (sentHere.remove(next.id) || (firstHistory && pickedBeforeHistory)) return
        settings = next.settings
    }

    fun pick(next: ResumeSettings) {
        if (sent == null) pickedBeforeHistory = true
        settings = next
    }

    fun start(next: ResumeSettings) {
        if (settings == null) settings = next
    }

    fun noteSent(id: String) { sentHere += id }
}

@Composable
internal fun rememberThreadSettings(
    computer: String?,
    chatId: String,
    rootId: String?,
    sent: SentThreadSettings?,
): ThreadSettings {
    val picks = remember(computer, chatId, rootId) { ThreadSettings() }
    LaunchedEffect(picks, sent) { picks.follow(sent) }
    return picks
}
