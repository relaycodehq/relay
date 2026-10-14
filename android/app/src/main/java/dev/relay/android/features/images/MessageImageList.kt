package dev.relay.android.features.images

import androidx.compose.runtime.Immutable
import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteImageSource
import java.io.ByteArrayOutputStream
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// Ports of shared/answer-images.ts, the image half of shared/agent-trace.ts
// and mobile/src/ui/images/Images.tsx's messageImages.

/** Where a picture comes from. */
@Immutable
sealed interface ImageSource {
    data class Attached(val chatId: String, val imageId: String) : ImageSource
    data class Read(val chatId: String, val messageId: String, val path: String) : ImageSource
    /** Pasted into a message still on its way; [PendingImages] holds it. */
    data class Pending(val messageId: String, val index: Int) : ImageSource
    /** The preview's last frame a turn kept; only desktops from Bridge.PREVIEW hand it out. */
    data class Preview(val chatId: String, val messageId: String) : ImageSource
}

internal fun ImageSource.remote(): RemoteImageSource? = when (this) {
    is ImageSource.Attached -> RemoteImageSource.attached(chatId, imageId)
    is ImageSource.Read -> RemoteImageSource.read(chatId, messageId, path)
    is ImageSource.Pending -> null
    is ImageSource.Preview -> RemoteImageSource.preview(chatId, messageId)
}

/**
 * The data URLs of images in messages not yet sent; the composer sets
 * [lookup] to read its outbox (mobile/src/remote/outbox.ts outgoingImage).
 */
object PendingImages {
    @Volatile var lookup: (messageId: String, index: Int) -> String? = { _, _ -> null }
}

@Immutable
data class LightboxImage(val source: ImageSource, val name: String)

private val IMAGE_FILE = Regex("""\.(?:png|jpe?g|gif|webp)$""", RegexOption.IGNORE_CASE)

/** An image Relay can show, by its name. */
fun isImagePath(path: String) = IMAGE_FILE.containsMatchIn(path)

private val MARKDOWN_IMAGE = Regex("""!\[[^\]\n]*]\(\s*<?([^\s<>()]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)""")
private val SCHEME = Regex("^[a-z][a-z\\d+.-]*:", RegexOption.IGNORE_CASE)
private val DRIVE = Regex("^[a-z]:[\\\\/]", RegexOption.IGNORE_CASE)
private val FILE_URL = Regex("^file://", RegexOption.IGNORE_CASE)

/** decodeURIComponent; null where that throws. */
private fun decodeOrNull(text: String): String? {
    if ('%' !in text) return text
    val out = StringBuilder()
    var i = 0
    while (i < text.length) {
        if (text[i] != '%') {
            out.append(text[i++])
            continue
        }
        val bytes = ByteArrayOutputStream()
        while (i < text.length && text[i] == '%') {
            if (i + 3 > text.length) return null
            bytes.write(text.substring(i + 1, i + 3).toIntOrNull(16) ?: return null)
            i += 3
        }
        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        try {
            out.append(decoder.decode(ByteBuffer.wrap(bytes.toByteArray())))
        } catch (_: CharacterCodingException) {
            return null
        }
    }
    return out.toString()
}

/**
 * The image file `src` of an answer's `![alt](src)` points at, or null when it
 * isn't one on this computer. Relative paths resolve against the thread's folder.
 */
fun localImagePath(src: String, root: String): String? {
    var path = src.trim()
    path = when {
        FILE_URL.containsMatchIn(path) ->
            runCatching { URI(path).rawPath }.getOrNull()?.let(::decodeOrNull) ?: return null
        // http:, data: and the like; a Windows drive letter isn't a scheme.
        SCHEME.containsMatchIn(path) && !DRIVE.containsMatchIn(path) -> return null
        else -> decodeOrNull(path) ?: return null
    }
    if (DRIVE.containsMatchIn(path)) return path.takeIf(::isImagePath)
    val parts = ArrayList<String>()
    for (part in (if (path.startsWith("/")) path else "$root/$path").split("/")) {
        if (part == "..") parts.removeLastOrNull()
        else if (part.isNotEmpty() && part != ".") parts += part
    }
    val full = "/" + parts.joinToString("/")
    return full.takeIf(::isImagePath)
}

/** The local image files an answer embeds, so only those can be read for it. */
fun answerImagePaths(body: String, root: String): List<String> =
    MARKDOWN_IMAGE.findAll(body).mapNotNull { localImagePath(it.groupValues[1], root) }.distinct().toList()

/** The picture a call looked at or made, by path. */
fun imagePath(a: AgentActivity): String? = a.image ?: a.label.takeIf { a.kind == "read" && isImagePath(it) }

/** A call that looks at or made an image Relay can show; it's still running or done. */
fun looksAtImage(a: AgentActivity) = (a.status == "running" || a.status == "complete") && imagePath(a) != null

/** The image a finished call looked at or made, which the desktop hands out for its turn. */
fun imageRead(a: AgentActivity): String? = if (looksAtImage(a) && a.status == "complete") imagePath(a) else null

/** The images a turn's calls read, once each, in order. */
fun turnImages(message: ChatMessage): List<String> {
    val calls = message.trace?.mapNotNull { if (it.kind == "activity") it.activity else null } ?: message.activity.orEmpty()
    return calls.mapNotNull(::imageRead).distinct()
}

private fun fileName(path: String) = path.substringAfterLast('/').ifEmpty { path }

/**
 * Every image of a message, in the order the lightbox steps through them:
 * pasted ones, those its answer shows (under [root]), then, once the turn
 * ends, the rest its agent read.
 */
@Immutable
data class MessageImageList(
    val all: List<LightboxImage>,
    /** Pasted ones: the row's share while the open trace shows the read ones under their calls. */
    val pasted: List<LightboxImage>,
    /** The pasted and the unshown read ones, for the row under the message. */
    val strip: List<LightboxImage>,
    /** What the agent has looked at so far, which its trace rows open among. */
    val looked: List<LightboxImage>,
)

fun messageImages(chatId: String, message: ChatMessage, root: String? = null): MessageImageList {
    fun read(path: String) = LightboxImage(ImageSource.Read(chatId, message.id, path), fileName(path))
    val pasted = message.images.orEmpty().mapIndexed { index, image ->
        LightboxImage(
            if (message.pending == true) ImageSource.Pending(message.id, index) else ImageSource.Attached(chatId, image.id),
            image.name,
        )
    }
    val streaming = message.status == "streaming"
    val shown = if (message.role == "assistant" && root != null) answerImagePaths(message.body, root) else emptyList()
    val turn = turnImages(message)
    val unshown = if (streaming) emptyList() else turn.filter { it !in shown }.map(::read)
    return MessageImageList(
        all = pasted + (if (streaming) emptyList() else shown.map(::read)) + unshown,
        pasted = pasted,
        strip = pasted + unshown,
        looked = turn.map(::read),
    )
}
