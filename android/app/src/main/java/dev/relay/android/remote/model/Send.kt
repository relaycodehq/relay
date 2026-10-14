package dev.relay.android.remote.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class ModelChoice(val model: String, val fast: Boolean = false, val reasoningEffort: String = "")

/** Which agent carries a message, and how (`resumeSettingsSchema`). Also the queue's `RemoteSettings`. */
@Serializable
data class ResumeSettings(
    val provider: String,
    val choice: ModelChoice,
    val contextWindow: String? = null,
    val runtimeMode: String,
    val interactionMode: String,
)

@Serializable data class PastedImage(val name: String, val mimeType: String, val dataUrl: String)
@Serializable data class FromThread(val id: String, val name: String)

/** `projectChatSendSchema`, strict on the desktop: leave anything unset as null. */
@Serializable
data class ProjectChatSend(
    val id: String,
    val body: String,
    val choice: ModelChoice,
    val provider: String,
    val runtimeMode: String,
    val interactionMode: String,
    /** "queue" | "steer" */
    val delivery: String? = null,
    val sendAt: Long? = null,
    /** Only "200k". */
    val contextWindow: String? = null,
    val account: String? = null,
    /** An agent, or "message" for a note. Dropped for desktops before [dev.relay.android.remote.Bridge.RECIPIENT]. */
    val to: String? = null,
    val parentId: String? = null,
    val side: Boolean? = null,
    val viewing: String? = null,
    /** A line question (`lineQuestionSchema`). */
    val selection: JsonObject? = null,
    val images: List<PastedImage>? = null,
    val fromThread: FromThread? = null,
    val pageAnswer: PageAnswer? = null,
    /** Only for desktops from [dev.relay.android.remote.Bridge.SKILLS]. */
    val skills: List<SentSkill>? = null,
    val fixes: List<String>? = null,
)
