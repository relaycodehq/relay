package dev.relay.android.remote.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** A thread as the phone holds it, every message whole (see [dev.relay.android.remote.delta.applyChatPatch]). */
@Serializable
data class RemoteChat(
    val id: String,
    val projectId: String,
    val title: String,
    val messages: List<ChatMessage> = emptyList(),
    val requests: List<AgentRequest>? = null,
    val queuePaused: Boolean? = null,
    val scope: ChatScope,
    val stopped: StoppedWorkList? = null,
    val pending: List<ChatPending>? = null,
    val worktree: ChatWorktree? = null,
    /** From Bridge.WORKSPACE_MOVES. */
    val workspaceMoves: List<WorkspaceMove>? = null,
    val running: Boolean = false,
    val root: String? = null,
    val earlier: Int = 0,
    val cost: ThreadCost? = null,
    val queue: List<RemoteQueued> = emptyList(),
    val scheduled: List<RemoteQueued> = emptyList(),
    val settings: ResumeSettings? = null,
    val lastParentId: String? = null,
    val hasSend: Boolean? = null,
    val sendPending: Boolean? = null,
)

/** `{kind:"project"} | {kind:"pr", ref} | {kind:"review"}`; `ref` stays raw. */
@Serializable data class ChatScope(val kind: String, val ref: JsonElement? = null)

@Serializable data class StoppedWorkList(val at: Long, val items: List<ChatPending>)

@Serializable
data class ChatWorktree(
    val path: String? = null,
    val branch: String? = null,
    val named: String? = null,
    val wanted: JsonObject? = null,
    val from: String? = null,
    val head: String? = null,
    val start: String? = null,
    val base: String? = null,
    val landed: JsonObject? = null,
)

/** `shared/projects/worktrees.ts` WorkspaceMove: the thread works somewhere else from [after] on. */
@Serializable
data class WorkspaceMove(
    val at: Long,
    /** The main conversation's last message before it; its line shows under that one. */
    val after: String? = null,
    /** "moved" | "recreated" | "switched" | "project" */
    val how: String,
    /** The folder it works in from here on; null for the project folder. */
    val to: String? = null,
    val branch: String? = null,
    val fresh: Boolean? = null,
    val unasked: Boolean? = null,
    val by: String? = null,
    /** The name of the project it moved to. */
    val project: String? = null,
)

@Serializable
data class AgentRequest(
    val id: String,
    /** "approval" | "question" | "page" */
    val kind: String,
    val title: String,
    val detail: String? = null,
    val note: String? = null,
    /** Strings ("accept", …) or richer decisions; left raw. */
    val decisions: List<JsonElement>? = null,
    val questions: List<AgentQuestion>? = null,
    val page: HtmlRender? = null,
)

@Serializable data class ThreadCost(val usd: Double, val answers: Int, val models: List<ModelCost>)
@Serializable data class ModelCost(val name: String, val usd: Double)

@Serializable
data class RemoteQueued(
    val id: String,
    val body: String,
    val images: Int? = null,
    val error: String? = null,
    val parentId: String? = null,
    val to: String? = null,
    val settings: ResumeSettings? = null,
    /** Only on scheduled ones: when it goes out. */
    val at: Long? = null,
    /** When it was sent; older desktops leave it out. */
    val created: Long? = null,
    /**
     * A steer held a moment before its agent gets it, to be taken back: it shows as the
     * message it becomes, not in the queue. Older desktops leave it out.
     */
    val held: Boolean? = null,
)

@Serializable
data class RemoteDiff(val path: String, val binary: Boolean, val hunks: List<DiffHunk>, val truncated: Boolean)
@Serializable data class DiffHunk(val header: String, val lines: List<DiffLine>)
/** kind: "add" | "del" | "same" */
@Serializable data class DiffLine(val kind: String, val text: String, val old: Int? = null, val new: Int? = null)

/** Which diff to ask for. */
@Serializable
data class RemoteDiffSource(
    /** "turn" | "working" | "commit" | "worktree" */
    val kind: String,
    val path: String,
    val chatId: String? = null,
    val messageId: String? = null,
    val where: String? = null,
    val area: String? = null,
    val sha: String? = null,
) {
    companion object {
        fun turn(chatId: String, messageId: String, path: String) = RemoteDiffSource("turn", path, chatId = chatId, messageId = messageId)
        fun working(where: String, path: String, area: String) = RemoteDiffSource("working", path, where = where, area = area)
        fun commit(where: String, sha: String, path: String) = RemoteDiffSource("commit", path, where = where, sha = sha)
        fun worktree(chatId: String, path: String) = RemoteDiffSource("worktree", path, chatId = chatId)
    }
}

@Serializable
data class RemoteImageSource(
    /** "attached" | "read" | "preview" (from Bridge.PREVIEW) */
    val kind: String,
    val chatId: String,
    val imageId: String? = null,
    val messageId: String? = null,
    val path: String? = null,
) {
    companion object {
        fun attached(chatId: String, imageId: String) = RemoteImageSource("attached", chatId, imageId = imageId)
        fun read(chatId: String, messageId: String, path: String) = RemoteImageSource("read", chatId, messageId = messageId, path = path)
        fun preview(chatId: String, messageId: String) = RemoteImageSource("preview", chatId, messageId = messageId)
    }
}

@Serializable
data class SubagentRun(
    val id: String,
    val taskId: String? = null,
    val description: String,
    val type: String? = null,
    val model: String? = null,
    val brief: String? = null,
    /** "running" | "completed" | "failed" | "stopped" */
    val status: String,
    val canStop: Boolean? = null,
    val started: Long,
    val ended: Long? = null,
    val summary: String? = null,
    val calls: Int = 0,
    val recent: List<AgentActivity> = emptyList(),
    val outcome: String? = null,
    val parentId: String? = null,
    val provider: String? = null,
    /** Only in a run read with subagentRun. */
    val trace: List<AgentTrace>? = null,
    val report: String? = null,
)

@Serializable data class SubagentList(val signature: String, val runs: List<SubagentRun>)
/** `run` is null for a session that is gone. */
@Serializable data class SubagentRunAnswer(val signature: String, val run: SubagentRun? = null)
