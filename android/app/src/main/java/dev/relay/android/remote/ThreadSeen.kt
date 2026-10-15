package dev.relay.android.remote

import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable
import java.io.File

/**
 * Which threads moved since this phone last looked (mobile/src/remote/seen.ts), as the
 * desktop's sidebar keeps it per device: a thread is unread once it updates after its last visit.
 */
class ThreadSeen(private val file: File, private val now: () -> Long = System::currentTimeMillis) {
    @Serializable
    data class State(
        val seen: Map<String, Long> = emptyMap(),
        /** The phone's first look; threads older than it aren't news. */
        val since: Long = 0,
    ) {
        fun readUpTo(chat: RemoteChatSummary) = maxOf(since, seen[chat.id] ?: 0L, chat.seenAt ?: 0L)
        fun movedSinceSeen(chat: RemoteChatSummary) = chat.updated > readUpTo(chat)

        /** The open thread, while the app is in front, only counts what moved; a mark doesn't stick to it. */
        fun unread(chat: RemoteChatSummary, openId: String? = null, foreground: Boolean = true) =
            if (chat.id == openId && foreground) movedSinceSeen(chat) else chat.markedUnread == true || movedSinceSeen(chat)
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    /** Marks a thread read up to `updated`, while it's open on the phone. */
    fun markSeen(id: String, updated: Long) {
        if ((_state.value.seen[id] ?: 0L) >= updated) return
        _state.update { it.copy(seen = it.seen + (id to updated)) }
        save()
    }

    private fun save() {
        try {
            file.parentFile?.mkdirs()
            file.writeText(RemoteJson.encodeToString(_state.value))
        } catch (_: Exception) {
        }
    }

    init {
        val saved = try {
            if (file.exists()) RemoteJson.decodeFromString<State>(file.readText()) else null
        } catch (_: Exception) {
            null
        }
        if (saved != null && saved.since > 0) _state.value = saved
        else {
            _state.value = State(saved?.seen.orEmpty(), now())
            save()
        }
    }
}
