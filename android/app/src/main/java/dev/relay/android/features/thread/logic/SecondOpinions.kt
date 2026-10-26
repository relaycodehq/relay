package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChatSummary

// src/features/second-opinion: another agent checks one of a thread's answers
// in a read-only thread of its own, listed under the answer it checks.

/** A finished answer of the main conversation; a side conversation's never reach its session. */
fun offersSecondOpinion(m: ChatMessage) =
    m.role == "assistant" && m.status == "complete" && m.body.isNotBlank() && m.parentId == null && m.side != true

fun isSecondOpinion(chat: RemoteChatSummary) = chat.startedBy?.secondOpinionOn != null

/** The second opinions asked on answer [answerId] of thread [lead]. */
fun opinionsOn(lead: String, answerId: String, chats: List<RemoteChatSummary>) =
    chats.filter { it.startedBy?.chatId == lead && it.startedBy.secondOpinionOn == answerId }.sortedBy { it.created }

/** Where a second opinion's thread stands, from its latest answer: "working", "failed", "stopped" or "finished". */
fun opinionStanding(chat: RemoteChatSummary, reply: ChatMessage?): String = when {
    chat.running == true -> "working"
    reply?.status == "failed" -> "failed"
    reply?.status == "cancelled" -> "stopped"
    // Not answering yet is only its first message on its way.
    reply?.body?.isNotBlank() == true -> "finished"
    else -> "working"
}

/** The card's title: who gives the opinion, by model once it has answered, else by agent. */
fun opinionTitle(provider: String?, model: String?): String {
    val by = model?.takeIf { it.isNotBlank() } ?: provider?.let(::agentName)
    return if (by != null) "Second opinion · $by" else "Second opinion"
}

/** What the card's footer says before it's sent back. */
fun unsentLine(checked: String, error: String?) = error ?: "${agentName(checked)} hasn't seen this."
