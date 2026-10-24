package dev.relay.android.remote.outbox

import dev.relay.android.remote.files.AttachedFile
import dev.relay.android.remote.files.bodyWithFiles
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
    /** The desktop answered with a refusal: only you trying again sends it again. */
    val refused: Boolean? = null,
    /** The draft it came from, which the desktop holds part of: it goes through the desktop's composer. */
    val draft: String? = null,
    /** Files that go up before it, and how far each got; the body names them once they're there. */
    val files: List<AttachedFile>? = null,
) {
    /** What goes to the computer once every file is there. */
    fun withPaths(): ProjectChatSend =
        if (files.isNullOrEmpty()) send else send.copy(body = bodyWithFiles(send.body, files.map { it.path ?: error("${it.name} isn't uploaded yet.") }))
}

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

/** How much of its files are on its computer, while any still has to go up; null with none left to go. */
fun uploadPercent(o: Outgoing): Int? {
    val files = o.files ?: return null
    if (files.all { it.path != null && it.computer == o.computer }) return null
    val size = files.sumOf { it.size }
    // What went to another computer goes again.
    val there = files.sumOf { if (it.computer != o.computer) 0 else if (it.path != null) it.size else it.received }
    return if (size <= 0) 0 else (there * 100 / size).toInt().coerceIn(0, 99)
}

/** How the thread shows one until the desktop's copy arrives. */
fun outgoingMessage(o: Outgoing): ChatMessage = ChatMessage(
    id = o.send.id,
    role = "user",
    // Its files by name, on lines of their own, as the computer's copy will show them.
    body = (listOf(o.send.body.trim()).filter { it.isNotEmpty() } + o.files.orEmpty().map { it.name }).joinToString("\n"),
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
