package dev.relay.android.remote.files

import kotlinx.serialization.Serializable
import java.util.UUID
import kotlin.math.roundToLong

// The phone's side of shared/remote.ts's `uploadFile` (bridge 33): a file goes
// up in chunks into the computer's paste folder, and the message names it.

/** What a phone uploads per `uploadFile` call, before base64 (shared/remote-models.ts fileUploadChunk). */
const val FILE_UPLOAD_CHUNK = 1024 * 1024
/** The largest file a phone may attach (shared/remote-models.ts maxUploadBytes). */
const val MAX_UPLOAD_BYTES = 200L * 1024 * 1024

const val FILES_NEED_UPDATE = "Update Relay on your computer to attach files."
const val FILE_TOO_LARGE = "That file is too large. Files can be up to 200 MB."

/** Waits before each automatic retry of an upload; then it's the outbox's Try again. */
val uploadRetryDelays = listOf(2_000L, 8_000L, 30_000L)

/**
 * A file going with a message: the phone's copy at [local], and how far it got
 * to [computer] under [uploadId]. [path] is where that computer keeps it once
 * all of it is there.
 */
@Serializable
data class AttachedFile(
    val local: String,
    val name: String,
    val size: Long,
    val uploadId: String = UUID.randomUUID().toString(),
    val computer: String? = null,
    val received: Long = 0,
    val path: String? = null,
) {
    /** Bound for [to]: what went to another computer starts over there under a new id. */
    fun on(to: String) = if (computer == to) this else copy(uploadId = UUID.randomUUID().toString(), computer = to, received = 0, path = null)

    val percent: Int get() = if (size <= 0) 100 else (received * 100 / size).toInt().coerceIn(0, 100)
}

/** The bytes to send next: from what the computer said it has, at most a chunk. */
fun nextChunk(received: Long, size: Long, chunk: Int = FILE_UPLOAD_CHUNK): LongRange {
    val from = received.coerceIn(0, size)
    return from until minOf(size, from + chunk)
}

/** The message with each file's path on a line of its own after the text, as the desktop's file pills read. */
fun bodyWithFiles(text: String, paths: List<String>): String =
    (listOf(text.trim()).filter { it.isNotEmpty() } + paths.map { "`$it`" }).joinToString("\n")

private val attachedPath = Regex("`[^`\\n]*[\\\\/]pastes[\\\\/][0-9a-f-]{36}[\\\\/]([^\\\\/`\\n]+)`")

/** A message as shown: each attached file's path down to its name, and where those names are. */
data class ShownFiles(val text: String, val names: List<IntRange>)

fun shownFiles(body: String): ShownFiles {
    val names = mutableListOf<IntRange>()
    val out = StringBuilder()
    var last = 0
    for (m in attachedPath.findAll(body)) {
        out.append(body, last, m.range.first)
        val name = m.groupValues[1]
        names += out.length until out.length + name.length
        out.append(name)
        last = m.range.last + 1
    }
    out.append(body, last, body.length)
    return ShownFiles(out.toString(), names)
}

/** A size as the strip shows it: "820 KB", "12.4 MB". */
fun fileSize(bytes: Long): String = when {
    bytes < 1000 -> "$bytes B"
    bytes < 1_000_000 -> "${(bytes / 1000.0).roundToLong()} KB"
    bytes < 1_000_000_000 -> "${"%.1f".format(java.util.Locale.ROOT, bytes / 1_000_000.0)} MB"
    else -> "${"%.1f".format(java.util.Locale.ROOT, bytes / 1_000_000_000.0)} GB"
}
