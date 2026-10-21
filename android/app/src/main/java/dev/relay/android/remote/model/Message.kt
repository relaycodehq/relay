package dev.relay.android.remote.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** `shared/projects/messages.ts` ChatMessage. Enum-like fields stay strings so newer values decode. */
@Serializable
data class ChatMessage(
    val id: String,
    /** "user" | "assistant" */
    val role: String,
    val body: String,
    /** "complete" | "streaming" | "failed" | "cancelled" */
    val status: String,
    val created: Long,
    val provider: String,
    val version: Long,
    val error: String? = null,
    val sentSettings: ResumeSettings? = null,
    val resumed: Boolean? = null,
    val handedOver: Boolean? = null,
    val compaction: Boolean? = null,
    val compactSummary: String? = null,
    val compactedFrom: Double? = null,
    val handoff: AgentHandoff? = null,
    val reload: JsonObject? = null,
    val worktreeCommand: WorktreeCommandRun? = null,
    val unprompted: Boolean? = null,
    val context: ContextUsage? = null,
    val cost: Double? = null,
    val streamed: JsonObject? = null,
    val model: TurnModel? = null,
    val proposedPlan: Boolean? = null,
    val steered: Boolean? = null,
    val asyncQuestionAnswer: Boolean? = null,
    val pageAnswer: PageAnswer? = null,
    val unread: Boolean? = null,
    val missed: Boolean? = null,
    val side: Boolean? = null,
    val images: List<ChatImage>? = null,
    val skills: List<SentSkill>? = null,
    val activity: List<AgentActivity>? = null,
    val trace: List<AgentTrace>? = null,
    /** Dropped finished calls by kind ("command", …, "failed"). */
    val traceDropped: Map<String, Int>? = null,
    val questions: List<AsyncAgentQuestions>? = null,
    /** Watch notes (shared/watch); untyped until a feature needs them. */
    val notes: List<JsonElement>? = null,
    val renders: List<HtmlRender>? = null,
    val preview: TurnPreview? = null,
    val changes: List<TurnFileChange>? = null,
    val forkPoint: ForkPoint? = null,
    val signIn: String? = null,
    val ended: Long? = null,
    val author: String? = null,
    val authorId: String? = null,
    val fromThread: String? = null,
    val seq: Long? = null,
    val parentId: String? = null,
    val pending: Boolean? = null,
) {
    val streaming get() = status == "streaming"
}

@Serializable
data class AgentActivity(
    val id: String,
    /** "command" | "file" | "read" | "search" | "web" | "agent" | "tool" */
    val kind: String,
    val label: String,
    /** "running" | "complete" | "failed" | "stopped" */
    val status: String,
    val detail: String? = null,
    val questionAnswers: List<AskedQuestion>? = null,
    /** Characters the desktop left out of [detail]; `activityDetail` has them all. */
    val detailCut: Int? = null,
    val parentId: String? = null,
    val progress: String? = null,
    val mcp: McpCall? = null,
    val image: String? = null,
)

@Serializable data class McpCall(val server: String, val tool: String)
@Serializable data class AskedQuestion(val question: String, val answer: String)

/** `{kind:"commentary", id, text} | {kind:"activity", id, activity}`, flattened. */
@Serializable
data class AgentTrace(
    val kind: String,
    val id: String,
    val text: String? = null,
    val activity: AgentActivity? = null,
) {
    val isCommentary get() = kind == "commentary"
}

@Serializable
data class ChatImage(val id: String, val name: String, val mimeType: String, val sizeBytes: Long)

@Serializable data class SentSkill(val name: String, val label: String)

@Serializable
data class AgentQuestion(
    val id: String,
    val header: String? = null,
    val question: String,
    val isSecret: Boolean? = null,
    val multiple: Boolean? = null,
    val allowCustomAnswer: Boolean? = null,
    val options: List<QuestionOption>? = null,
)

@Serializable data class QuestionOption(val label: String, val description: String? = null, val value: String? = null)

@Serializable
data class AsyncAgentQuestions(
    val id: String,
    val page: HtmlRender? = null,
    val questions: List<AgentQuestion>,
    val answers: Map<String, List<String>>? = null,
    val dismissed: Boolean? = null,
)

@Serializable
data class HtmlRender(val id: String, val title: String, val pages: List<HtmlRenderPage>, val created: Long)

@Serializable data class HtmlRenderPage(val label: String? = null, val heights: List<Double>? = null)

@Serializable
data class TurnFileChange(
    val path: String,
    val additions: Int,
    val deletions: Int,
    val binary: Boolean? = null,
    val revertedBy: String? = null,
)

@Serializable
data class ContextUsage(
    val usedTokens: Long,
    val maxTokens: Long? = null,
    val totalTokens: Long? = null,
    val cache: PromptCache? = null,
)

@Serializable data class PromptCache(val at: Long, val ttlMs: Long)

@Serializable
data class TurnModel(
    val name: String,
    val byDefault: Boolean? = null,
    val effort: String = "",
    val effortByDefault: Boolean? = null,
    val fast: Boolean? = null,
    val window: String? = null,
    val plan: Boolean? = null,
)

@Serializable data class PageAnswer(val title: String, val skipped: Boolean? = null)

@Serializable
data class AgentHandoff(val from: String, val to: String, val computer: String? = null, val byRelay: Boolean? = null)

@Serializable
data class WorktreeCommandRun(
    val kind: String,
    val command: String,
    val output: String,
    val copied: List<String>? = null,
    val exitCode: Int? = null,
    val stopped: String? = null,
)

@Serializable data class TurnPreview(val url: String, val title: String, val at: Long, val shot: Boolean? = null)

@Serializable data class ForkPoint(val thread: String, val at: String)
