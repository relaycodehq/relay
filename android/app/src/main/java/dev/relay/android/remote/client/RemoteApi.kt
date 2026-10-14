package dev.relay.android.remote.client

import dev.relay.android.remote.delta.applyChatPatch
import dev.relay.android.remote.delta.knownOf
import dev.relay.android.remote.model.ComputerInfo
import dev.relay.android.remote.model.DictationHeard
import dev.relay.android.remote.model.DictationRequest
import dev.relay.android.remote.model.DraftWrite
import dev.relay.android.remote.model.PhoneAppReport
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.ReadAloudAudio
import dev.relay.android.remote.model.ReadAloudRequest
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteDiff
import dev.relay.android.remote.model.RemoteDiffSource
import dev.relay.android.remote.model.RemoteImageSource
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProjectIcon
import dev.relay.android.remote.model.SentChat
import dev.relay.android.remote.model.SharedDraft
import dev.relay.android.remote.model.SubagentList
import dev.relay.android.remote.model.SubagentRunAnswer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject

// Typed bridge calls (RemoteApi in shared/remote.ts). Each throws what
// RemoteClient.call does; ones a desktop may lack say from which bridge.

private fun s(value: String?): JsonElement? = value?.let(::JsonPrimitive)
private fun n(value: Number?): JsonElement? = value?.let(::JsonPrimitive)
private inline fun <reified T> j(value: T?): JsonElement? = value?.let { RemoteJson.encodeToJsonElement(it) }
private inline fun <reified T> JsonElement.to(): T = RemoteJson.decodeFromJsonElement(this)
/** Optional arguments left out at the end go, as a TS caller leaving them out sends them. */
private fun args(vararg values: JsonElement?): List<JsonElement?> {
    val list = values.toMutableList()
    while (list.isNotEmpty() && list.last() == null) list.removeAt(list.lastIndex)
    return list
}

suspend fun RemoteClient.overview(): RemoteOverview = call("overview").to()

/** The thread with its latest messages, those [previous] holds at the same version reused. */
suspend fun RemoteClient.chat(id: String, previous: RemoteChat? = null, history: Int? = null, sendId: String? = null): RemoteChat {
    val patch = call("chat", args(s(id), j(knownOf(previous)), n(history), s(sendId)))
    return applyChatPatch(patch.jsonObject, previous)
}

suspend fun RemoteClient.diff(source: RemoteDiffSource): RemoteDiff = call("diff", args(j(source))).to()

/** Icons that differ from the phone's [known] hashes (null for "none"), by project id. */
suspend fun RemoteClient.projectIcons(known: Map<String, String?>): Map<String, RemoteProjectIcon> =
    call("projectIcons", listOf(RemoteJson.encodeToJsonElement(known))).to()

/** Null when unchanged since [known]. From Bridge.SUBAGENTS. */
suspend fun RemoteClient.subagents(chatId: String, known: String? = null): SubagentList? =
    call("subagents", args(s(chatId), s(known))).takeUnless { it is JsonNull }?.to()

/** Null when unchanged; a missing session answers a signed `run: null`. From Bridge.SUBAGENTS. */
suspend fun RemoteClient.subagentRun(chatId: String, agentId: String, known: String? = null): SubagentRunAnswer? =
    call("subagentRun", args(s(chatId), s(agentId), s(known))).takeUnless { it is JsonNull }?.to()

/** A tool call's whole output. From Bridge.ACTIVITY_DETAIL. */
suspend fun RemoteClient.activityDetail(chatId: String, messageId: String, activityId: String): String? =
    call("activityDetail", args(s(chatId), s(messageId), s(activityId))).takeUnless { it is JsonNull }?.to()

/** A data URL at most [max] pixels on its longer side. From Bridge.IMAGE. */
suspend fun RemoteClient.image(source: RemoteImageSource, max: Int): String = call("image", args(j(source), n(max))).to()

/** One page's HTML. From Bridge.RENDER. */
suspend fun RemoteClient.renderPage(chatId: String, renderId: String, page: Int): String =
    call("renderPage", args(s(chatId), s(renderId), n(page))).to()

/** The draft as it stands after, null once gone. From Bridge.DRAFTS. */
suspend fun RemoteClient.saveDraft(write: DraftWrite): SharedDraft? =
    call("saveDraft", args(j(write))).takeUnless { it is JsonNull }?.to()

suspend fun RemoteClient.draftOther(key: String, drop: Boolean): SharedDraft? =
    call("draftOther", listOf(JsonPrimitive(key), JsonPrimitive(drop))).takeUnless { it is JsonNull }?.to()

/** Sends through the desktop's composer; [chatId] null starts a thread. From Bridge.DRAFTS. */
suspend fun RemoteClient.sendDraft(key: String, chatId: String?, send: ProjectChatSend): SentChat =
    call("sendDraft", listOf(JsonPrimitive(key), s(chatId), j(send))).to()

suspend fun RemoteClient.dictate(request: DictationRequest): DictationHeard = call("dictate", args(j(request))).to()

/** From Bridge.READ_ALOUD. */
suspend fun RemoteClient.readAloud(request: ReadAloudRequest): ReadAloudAudio = call("readAloud", args(j(request))).to()

/** From Bridge.PHONE_UPDATES. */
suspend fun RemoteClient.computerInfo(): ComputerInfo = call("computerInfo").to()

/** Shared/updates' UpdateState, raw. From Bridge.PHONE_UPDATES. */
suspend fun RemoteClient.updateNow(): JsonElement = call("updateNow")

suspend fun RemoteClient.reportApp(report: PhoneAppReport) {
    call("reportApp", args(j(report)))
}

/** Up to Bridge.PHONE_APP_CHUNK bytes from [offset], as base64. */
suspend fun RemoteClient.phoneAppFile(path: String, offset: Long): String =
    call("phoneAppFile", args(s(path), n(offset))).to()

/** `desktop("sendProjectChat", [chatId, send])`, with `to` dropped for desktops before Bridge.RECIPIENT. */
suspend fun RemoteClient.sendProjectChat(chatId: String, send: ProjectChatSend): JsonElement =
    desktop("sendProjectChat", listOf(JsonPrimitive(chatId), j(send)))
