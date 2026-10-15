package dev.relay.android.remote.outbox

import dev.relay.android.remote.model.ChatImage
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ProjectChatSend
import dev.relay.android.remote.model.RemoteChat
import kotlinx.serialization.Serializable
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToLong

// mobile/src/remote/outbox-state.ts: the outbox's rules, apart from disk and link.

@Serializable
data class Outgoing(
    /** The paired computer it's for; it only ever goes to that one. */
    val computer: String,
    val chatId: String,
    val send: ProjectChatSend,
    val created: Long,
    /** The desktop took it, at this [stamp]; it goes once the thread holds it. */
    val sent: Long? = null,
    val error: String? = null,
    /** No answer came back, so the desktop may have it all the same. */
    val unsure: Boolean? = null,
    /** The draft it came from, which the desktop holds part of: it goes through the desktop's composer. */
    val draft: String? = null,
)

private val clock = AtomicLong()

/** Orders the desktop's answers to sends against the thread fetches made on this phone. */
fun stamp() = clock.incrementAndGet()

/** Every send the thread holds: as a message, waiting in its queue, or sent with Send later. */
fun heldIds(thread: RemoteChat?): Set<String> {
    if (thread == null) return emptySet()
    return buildSet {
        thread.messages.forEach { add(it.id) }
        thread.queue.forEach { add(it.id) }
        thread.scheduled.forEach { add(it.id) }
    }
}

/**
 * The sends done with once thread [chatId] reads as [held], from a fetch made
 * at [fetched]: the ones it holds, and the ones the desktop took before that
 * fetch which it holds nowhere any more.
 */
fun settled(items: List<Outgoing>, computer: String, chatId: String, held: Set<String>, fetched: Long) =
    items.filter {
        it.computer == computer && it.chatId == chatId &&
            (it.send.id in held || (it.sent != null && it.sent < fetched))
    }

/** How the thread shows one until the desktop's copy arrives. */
fun outgoingMessage(o: Outgoing): ChatMessage = ChatMessage(
    id = o.send.id,
    role = "user",
    body = o.send.body,
    status = "complete",
    created = o.created,
    provider = o.send.provider,
    version = 0,
    pending = true,
    error = o.error?.let { if (o.unsure == true) "Maybe not sent: $it" else "Not sent: $it" },
    images = o.send.images?.takeIf { it.isNotEmpty() }?.mapIndexed { i, image ->
        ChatImage("${o.send.id}:$i", image.name, image.mimeType, (image.dataUrl.length * 3 / 4.0).roundToLong())
    },
    parentId = o.send.parentId,
    side = if (o.send.side == true) true else null,
)
