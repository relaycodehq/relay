package dev.relay.android.features.thread

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.HtmlRender

internal enum class MessageSection { Whole, Header, Body }

/** A card settling above the reader mustn't change the anchor of the answer text below it. */
internal sealed interface ThreadMessageRow {
    val message: ChatMessage
    val key: String

    data class Content(override val message: ChatMessage, val section: MessageSection) : ThreadMessageRow {
        override val key = if (section == MessageSection.Header) "${message.id}:header" else message.id
    }

    data class Render(override val message: ChatMessage, val render: HtmlRender, val ordinal: Int) : ThreadMessageRow {
        override val key = "${message.id}:render:${render.id}"
    }
}

internal fun threadMessageRows(messages: List<ChatMessage>): List<ThreadMessageRow> = buildList {
    for (message in messages) {
        val split = message.role == "assistant" && !message.renders.isNullOrEmpty() &&
            message.handedOver != true && message.handoff == null && message.worktreeCommand == null &&
            message.reload == null && message.compaction != true
        if (!split) add(ThreadMessageRow.Content(message, MessageSection.Whole))
        else {
            add(ThreadMessageRow.Content(message, MessageSection.Header))
            message.renders.orEmpty().forEachIndexed { i, render -> add(ThreadMessageRow.Render(message, render, i)) }
            add(ThreadMessageRow.Content(message, MessageSection.Body))
        }
    }
}
