package dev.relay.android.remote.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class RemoteOverview(
    val name: String,
    /** Missing on desktops from before it was sent. */
    val bridge: Int? = null,
    val version: String? = null,
    val appearance: PhoneAppearance? = null,
    val phoneApp: PhoneAppRelease? = null,
    /** "missing" | "downloading" | "ready" | "failed" | "unsupported"; null where dictation isn't offered. */
    val dictation: String? = null,
    val readAloud: Boolean? = null,
    val drafts: List<SharedDraft>? = null,
    val projects: List<RemoteProject> = emptyList(),
    /** Unarchived threads with messages, newest first. */
    val chats: List<RemoteChatSummary> = emptyList(),
)

@Serializable
data class RemoteProject(
    val id: String,
    val name: String,
    val folder: String? = null,
    val scratch: Boolean? = null,
    val plain: Boolean? = null,
    /** "checkout" | "worktree" */
    val workspace: String? = null,
)

/** `{hash, dataUrl}`, or `{hash: null}` for a project without one. */
@Serializable
data class RemoteProjectIcon(val hash: String? = null, val dataUrl: String? = null)

@Serializable
data class RemoteChatSummary(
    val id: String,
    val projectId: String,
    val title: String,
    /** "project" | "pr" | "review" */
    val scope: String,
    val updated: Long,
    val created: Long,
    val provider: String? = null,
    val running: Boolean? = null,
    val runningSince: Long? = null,
    val waiting: Boolean? = null,
    val asking: Boolean? = null,
    val blocked: Boolean? = null,
    val settledAt: Long? = null,
    val settleWhenDone: Long? = null,
    val autoSettled: Boolean? = null,
    val markedUnread: Boolean? = null,
    val snoozedAt: Long? = null,
    val snoozedUntil: Long? = null,
    val seenAt: Long? = null,
    val branch: String? = null,
    val worktree: Boolean? = null,
    val pending: List<ChatPending>? = null,
    val nextSend: Long? = null,
    val queueMark: String? = null,
    val empty: Boolean? = null,
    val goal: ThreadGoal? = null,
    val startedBy: StartedBy? = null,
    val limitResume: LimitResume? = null,
)

/** `{kind:"task", id, description, since, agent?} | {kind:"wakeup", id, prompt, recurring, at?}`, flattened. */
@Serializable
data class ChatPending(
    val kind: String,
    val id: String,
    val description: String? = null,
    val since: Long? = null,
    val agent: Boolean? = null,
    val prompt: String? = null,
    val recurring: Boolean? = null,
    val at: Long? = null,
    /** On stopped work only: the side conversation whose session ran it. */
    val parentId: String? = null,
)

@Serializable
data class ThreadGoal(
    val provider: String,
    val objective: String,
    /** "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete" | "failed" */
    val status: String,
    val tokensUsed: Long? = null,
    val tokenBudget: Long? = null,
    val timeUsedSeconds: Double? = null,
    val checks: Int? = null,
    val lastCheck: String? = null,
    val gaveUp: Boolean? = null,
    val updated: Long,
)

@Serializable data class StartedBy(val chatId: String, val agent: String, val sendsApproved: Boolean? = null)

@Serializable
data class LimitResume(val messageId: String, val provider: String, val at: Long, val off: Boolean? = null)

@Serializable
data class PhoneAppRelease(val version: String, val runtime: String, val bundle: String, val files: List<PhoneAppFile>)

@Serializable data class PhoneAppFile(val path: String, val size: Long, val sha256: String)

@Serializable
data class PhonePalette(
    /** "light" | "dark" */
    val kind: String,
    val sidebar: String,
    val surface: String,
    val toolbar: String,
    val inbox: String,
    val text: String,
    val muted: String,
    val border: String,
    val hover: String,
    val selected: String,
    val accent: String,
    val accentSoft: String,
    val onAccent: String,
    /** The Send button's colour; older desktops leave it out. */
    val send: String? = null,
    val onSend: String? = null,
    val diffAddition: String,
    val diffDeletion: String,
)

@Serializable
data class PhoneAppearance(
    /** "system" | "light" | "dark" */
    val mode: String,
    val light: PhonePalette,
    val dark: PhonePalette,
)

@Serializable
data class PhoneAppReport(
    val version: String,
    val updated: Boolean,
    val apk: String,
    val updates: Boolean,
    val update: PhoneAppUpdate? = null,
    val failed: String? = null,
)

/** kind: "downloading" | "ready" | "apk" */
@Serializable data class PhoneAppUpdate(val kind: String, val version: String)

/** `update` is shared/updates' UpdateState, left raw. */
@Serializable data class ComputerInfo(val version: String, val bridge: Int, val update: JsonElement? = null)

/** a > b for x.y.z and x.y.z.n versions (shared/phone-app's `newerVersion`). Non-numbers count as NaN: never newer. */
fun newerVersion(a: String, b: String): Boolean {
    val x = a.split(".").map { it.toDoubleOrNull() ?: Double.NaN }
    val y = b.split(".").map { it.toDoubleOrNull() ?: Double.NaN }
    for (i in 0 until 4) {
        val p = x.getOrElse(i) { 0.0 }
        val q = y.getOrElse(i) { 0.0 }
        if (p != q) return p > q
    }
    return false
}
