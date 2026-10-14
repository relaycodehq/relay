package dev.relay.android.features.composer.logic

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ContextUsage
import dev.relay.android.remote.model.ModelCost
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.model.ThreadCost

// What a thread's composer reads from the thread: shared/context-usage,
// shared/recipient, shared/thread-cost and shared/remote-queued.

/** The main conversation: messages that don't reply to one in the thread. */
fun mainConversation(messages: List<ChatMessage>): List<ChatMessage> {
    val ids = messages.mapTo(HashSet()) { it.id }
    return messages.filter { it.parentId == null || it.parentId !in ids }
}

/** The newest reported usage on this branch, unless a compaction or another agent reset it since. */
fun latestContext(messages: List<ChatMessage>): ContextUsage? {
    var holder: String? = null
    for (m in messages.asReversed()) {
        if (m.role != "assistant" || m.reload != null || m.worktreeCommand != null) continue
        if (m.handoff != null) return null
        if (holder == null) holder = m.provider
        if (m.provider != holder) return null
        m.context?.let { return it }
        if (m.compaction == true && m.status == "complete") return null
    }
    return null
}

/** The agent holding a conversation's context: the last one to answer in it. */
fun contextAgent(conversation: List<ChatMessage>, rootId: String? = null): String? =
    conversation.lastOrNull {
        it.role == "assistant" && it.compaction != true && it.handoff == null && it.reload == null &&
            it.worktreeCommand == null && it.id != rootId
    }?.provider

/** Whether sending to `to` takes over from `holder`, losing its session. */
fun takesOver(to: String?, holder: String?) = to != null && to != "message" && holder != null && to != holder

fun threadCost(messages: List<ChatMessage>): ThreadCost? {
    val byModel = LinkedHashMap<String, Double>()
    var usd = 0.0
    var answers = 0
    for (m in messages) {
        val cost = m.cost ?: continue
        if (cost <= 0) continue
        usd += cost
        answers++
        val name = m.model?.name?.takeIf { it.isNotEmpty() } ?: "Default model"
        byModel[name] = (byModel[name] ?: 0.0) + cost
    }
    if (answers == 0) return null
    return ThreadCost(usd, answers, byModel.map { ModelCost(it.key, it.value) }.sortedByDescending { it.usd })
}

/** The agent and model a message went with, as a composer holds them. */
fun sentSettings(send: ProjectChatSend): ResumeSettings {
    val to = recipient(send)
    return ResumeSettings(if (to == "message") send.provider else to, send.choice, send.contextWindow, send.runtimeMode, send.interactionMode)
}
