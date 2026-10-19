package dev.relay.android.remote.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class SharedDraft(
    val key: String,
    val rev: Long,
    val at: Long,
    /** "desktop" or "phone:<deviceId>" */
    val by: String,
    val origin: String,
    val text: String,
    val skills: Map<String, String>? = null,
    val quotes: List<String>? = null,
    val files: List<String>? = null,
    val workspace: String? = null,
    val extras: DraftExtras? = null,
    val other: DraftOther? = null,
)

@Serializable
data class DraftExtras(
    val screenshots: List<Int>? = null,
    val codeRefs: Int? = null,
    val selection: Boolean? = null,
    val workItem: Boolean? = null,
    val links: Int? = null,
    val scope: String? = null,
    val branch: Boolean? = null,
    val start: Boolean? = null,
)

@Serializable data class DraftOther(val text: String, val by: String, val at: Long)

/** A phone's edit; the desktop's schema is strict, so only set what you mean. */
@Serializable
data class DraftWrite(
    val key: String,
    val base: Long,
    val at: Long,
    val text: String,
    val skills: Map<String, String>? = null,
    val quotes: List<String>? = null,
    val files: List<String>? = null,
    val workspace: String? = null,
    val sent: String? = null,
)

@Serializable data class DraftChange(val key: String, val draft: SharedDraft? = null, val sent: Boolean? = null)

@Serializable data class SentChat(val chatId: String)

@Serializable
data class DictationHeard(val settled: String, val tentative: String, val loading: Boolean)

@Serializable
data class ReadAloudAudio(val pcm: String, val sampleRate: Int, val loading: Boolean, val done: Boolean)

/** `PhoneDictation`: type "start" | "audio" | "stop" | "cancel". */
@Serializable
data class DictationRequest(val type: String, val id: Int, val pcm: String? = null)

/** `PhoneReadAloud`: type "start" | "pull" | "stop". */
@Serializable
data class ReadAloudRequest(val type: String, val id: Int, val markdown: String? = null)

/** Passed through untyped where a payload is rare. */
typealias RawObject = JsonObject
