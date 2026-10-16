package dev.relay.android.remote.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** A frame from the desktop. One flat shape: which fields are set depends on `t`. */
@Serializable
data class ServerFrame(
    /** "paired" | "ready" | "denied" | "result" | "event" | "tick" */
    val t: String,
    val deviceId: String? = null,
    val token: String? = null,
    val name: String? = null,
    val bridge: Int? = null,
    val hosts: List<String>? = null,
    val reason: String? = null,
    val id: Long? = null,
    val ok: Boolean? = null,
    val value: JsonElement? = null,
    val error: String? = null,
    /** Kept raw: messagePatch needs the JSON tree, and events have to be told apart first. */
    val event: JsonElement? = null,
    val s: Long? = null,
)

/** A thread list change patched onto the last list (`chatsPatch`). */
@Serializable data class ChatsPatch(val set: List<RemoteChatSummary> = emptyList(), val remove: List<String> = emptyList())

/** What the phone hears, once patches are applied. */
sealed interface RemoteEvent {
    data class Message(val chatId: String, val message: ChatMessage, val title: String?) : RemoteEvent
    data class Chats(val chats: List<RemoteChatSummary>) : RemoteEvent
    data class Appearance(val appearance: PhoneAppearance) : RemoteEvent
    /** Someone is at the computer working in Relay, or no longer; comes just before the thread list it applies to. */
    data class Presence(val present: Boolean) : RemoteEvent
    data class Draft(val change: DraftChange) : RemoteEvent
    /** Computers only; a phone ignores it. */
    data class Handoff(val raw: JsonElement) : RemoteEvent
}
