package dev.relay.android.features.thread

import dev.relay.android.features.markdown.MarkdownBlock
import dev.relay.android.features.markdown.MarkdownCache
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.HtmlRender

internal enum class MessageSection { Whole, Header, Body, Footer }

/** Content before the reader's paragraph can settle without moving that paragraph's anchor. */
internal sealed interface ThreadMessageRow {
    val message: ChatMessage
    val key: String

    data class Content(override val message: ChatMessage, val section: MessageSection) : ThreadMessageRow {
        override val key = if (section == MessageSection.Whole) message.id else "${message.id}:${section.name.lowercase()}"
    }
    data class Render(override val message: ChatMessage, val render: HtmlRender, val ordinal: Int) : ThreadMessageRow {
        override val key = "${message.id}:render:${render.id}"
    }
    data class Block(override val message: ChatMessage, val block: MarkdownBlock) : ThreadMessageRow {
        override val key = "${message.id}:line:${block.sourceLine}"
    }
}

/** Retained per loaded message, so one streaming tail doesn't reparse the whole conversation. */
internal class ThreadBodyRows {
    private val bodies = mutableMapOf<String, MarkdownCache>()
    internal val cachedMessages get() = bodies.size

    fun rows(messages: List<ChatMessage>): List<ThreadMessageRow> = buildList {
        val loaded = messages.mapTo(HashSet()) { it.id }
        bodies.keys.retainAll(loaded)
        for (message in messages) {
            val split = message.role == "assistant" && message.handedOver != true &&
                message.handoff == null && message.worktreeCommand == null && message.reload == null && message.compaction != true
            if (!split) {
                bodies.remove(message.id)
                add(ThreadMessageRow.Content(message, MessageSection.Whole))
            } else {
                add(ThreadMessageRow.Content(message, MessageSection.Header))
                message.renders.orEmpty().forEachIndexed { i, render -> add(ThreadMessageRow.Render(message, render, i)) }
                val blocks = bodies.getOrPut(message.id) { MarkdownCache() }.positioned(message.body)
                blocks.forEach { add(ThreadMessageRow.Block(message, it)) }
                add(ThreadMessageRow.Content(message, MessageSection.Footer))
            }
        }
    }
}

internal fun threadMessageRows(messages: List<ChatMessage>): List<ThreadMessageRow> = ThreadBodyRows().rows(messages)
