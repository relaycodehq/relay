package dev.relay.android.remote.client

import dev.relay.android.remote.delta.applyChatsPatch
import dev.relay.android.remote.delta.applyMessagePatch
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ChatsPatch
import dev.relay.android.remote.model.DraftChange
import dev.relay.android.remote.model.PhoneAppearance
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteEvent
import dev.relay.android.remote.model.RemoteJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A wire event as the phone hears it: patches applied against this
 * connection's last streaming answers and thread list, which it updates.
 * Null for a patch with nothing to apply to (both ends start over each
 * connection; the final answer comes whole) or an unknown kind.
 */
internal fun rebuildEvent(
    event: JsonObject,
    streaming: MutableMap<String, JsonObject>,
    chats: List<RemoteChatSummary>?,
    setChats: (List<RemoteChatSummary>) -> Unit,
): RemoteEvent? {
    fun text(element: JsonElement?) = (element as? JsonPrimitive)?.contentOrNull
    return when (text(event["kind"])) {
        "message", "messagePatch" -> {
            val message: JsonObject = if (text(event["kind"]) == "messagePatch") {
                val patch = event["patch"]!!.jsonObject
                val prev = streaming[patch["id"]!!.jsonPrimitive.content] ?: return null
                applyMessagePatch(prev, patch)
            } else event["message"]!!.jsonObject
            val decoded = RemoteJson.decodeFromJsonElement<ChatMessage>(message)
            if (decoded.status == "streaming") streaming[decoded.id] = message else streaming.remove(decoded.id)
            RemoteEvent.Message(event["chatId"]!!.jsonPrimitive.content, decoded, text(event["title"]))
        }
        "chats" -> {
            val list = RemoteJson.decodeFromJsonElement<List<RemoteChatSummary>>(event["chats"]!!)
            setChats(list)
            RemoteEvent.Chats(list)
        }
        "chatsPatch" -> {
            val was = chats ?: return null
            val list = applyChatsPatch(was, RemoteJson.decodeFromJsonElement<ChatsPatch>(event["patch"]!!))
            setChats(list)
            RemoteEvent.Chats(list)
        }
        "appearance" -> RemoteEvent.Appearance(RemoteJson.decodeFromJsonElement<PhoneAppearance>(event["appearance"]!!))
        "draft" -> RemoteEvent.Draft(RemoteJson.decodeFromJsonElement<DraftChange>(event["change"]!!))
        "handoff" -> RemoteEvent.Handoff(event)
        else -> null
    }
}

/** What [rebuildEvent] keeps per connection: answers still streaming, as JSON, and the last thread list. */
internal class ConnectionEvents {
    private val streaming = HashMap<String, JsonObject>()
    private var chats: List<RemoteChatSummary>? = null

    fun reset() {
        streaming.clear()
        chats = null
    }

    fun rebuild(event: JsonObject): RemoteEvent? = rebuildEvent(event, streaming, chats) { chats = it }
}
