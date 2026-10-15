package dev.relay.android.remote.delta

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ChatsPatch
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** shared/remote-delta's `applyList`: cut to `length`, then overwrite by index (holes become null, as in JS). */
fun applyListPatch(was: JsonArray?, patch: JsonObject): JsonArray {
    val length = patch["length"]!!.jsonPrimitive.int
    val list = (was ?: JsonArray(emptyList())).take(length).toMutableList<JsonElement>()
    for (entry in patch["items"]?.jsonArray.orEmpty()) {
        val pair = entry.jsonArray
        val i = pair[0].jsonPrimitive.int
        while (list.size <= i) list.add(JsonNull)
        list[i] = pair[1]
    }
    return JsonArray(list)
}

/**
 * shared/remote-delta's `applyMessagePatch`, on the JSON tree so fields this
 * app doesn't model survive. `body.from` is a UTF-16 index, as Kotlin's.
 */
fun applyMessagePatch(prev: JsonObject, patch: JsonObject): JsonObject {
    val next = LinkedHashMap<String, JsonElement>(prev)
    (patch["set"] as? JsonObject)?.let { next.putAll(it) }
    (patch["unset"] as? JsonArray)?.forEach { next.remove(it.jsonPrimitive.content) }
    (patch["body"] as? JsonObject)?.let { body ->
        val was = (prev["body"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        val from = body["from"]!!.jsonPrimitive.int.coerceIn(0, was.length)
        next["body"] = JsonPrimitive(was.substring(0, from) + body["text"]!!.jsonPrimitive.content)
    }
    for (key in listOf("trace", "activity")) {
        val list = patch[key] as? JsonObject ?: continue
        next[key] = applyListPatch(prev[key] as? JsonArray, list)
    }
    return JsonObject(next)
}

/** Newest first, then by id: the order both ends keep a thread list in. */
val chatOrder: Comparator<RemoteChatSummary> =
    Comparator { a, b -> b.updated.compareTo(a.updated).takeIf { it != 0 } ?: a.id.compareTo(b.id) }

fun applyChatsPatch(prev: List<RemoteChatSummary>, patch: ChatsPatch): List<RemoteChatSummary> {
    val chats = LinkedHashMap<String, RemoteChatSummary>()
    for (c in prev) chats[c.id] = c
    for (id in patch.remove) chats.remove(id)
    for (c in patch.set) chats[c.id] = c
    return chats.values.sortedWith(chatOrder)
}

class MissingMessage : Exception("Conversation update is missing a message.")

/** Message id → version the phone holds, sent as `known` so unchanged messages come back as ids. */
fun knownOf(chat: RemoteChat?): Map<String, Long>? = chat?.messages?.associate { it.id to it.version }

/** A `chat` answer with messages the phone already held sent as their ids; throws [MissingMessage]. */
fun applyChatPatch(patch: JsonObject, previous: RemoteChat?): RemoteChat {
    val held = previous?.messages?.associateBy { it.id }.orEmpty()
    val messages = patch["messages"]?.jsonArray.orEmpty().map { m ->
        if (m is JsonPrimitive && m.isString) held[m.content] ?: throw MissingMessage()
        else RemoteJson.decodeFromJsonElement<ChatMessage>(m.jsonObject)
    }
    val rest = JsonObject(patch - "messages")
    return RemoteJson.decodeFromJsonElement<RemoteChat>(rest).copy(messages = messages)
}
