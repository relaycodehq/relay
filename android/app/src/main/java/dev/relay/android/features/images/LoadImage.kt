package dev.relay.android.features.images

import android.graphics.BitmapFactory
import android.util.Base64
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.image
import java.util.Collections
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

// Data URLs by computer, source and size, so scrolling back doesn't fetch them again.
private val dataUrls = ImageCache()
// Decoded pictures, so a row mounted again doesn't decode again.
private val decoded = object : LruCache<String, DecodedImage>(48 * 1024 * 1024) {
    override fun sizeOf(key: String, value: DecodedImage) =
        value.bitmap.width * value.bitmap.height * 4 + (value.animation?.bytes?.size ?: 0)
}
// Ones the desktop refused, so the lightbox skips them as the desktop's does.
private val refused: MutableSet<String> = Collections.synchronizedSet(HashSet())
// The most pixels `image` takes for a side.
private const val LARGEST = 4096

private fun scoped(source: ImageSource, computer: String?) = "$computer|$source"

/** Whether the active computer refused this picture. */
fun imageFailed(source: ImageSource, computer: String?) = scoped(source, computer) in refused

/** A GIF's file as it came, which each place showing it plays with its own drawable. */
class ImageAnimation(val bytes: ByteArray)

/** [bitmap] is the first frame of an [animation]: what sizes it and what gets copied. */
@Immutable
data class LoadedImage(val bitmap: ImageBitmap?, val failed: Boolean, val animation: ImageAnimation? = null)

internal class DecodedImage(val bitmap: ImageBitmap, val animation: ImageAnimation?)

private fun isGif(bytes: ByteArray) =
    bytes.size >= 6 && String(bytes, 0, 6, Charsets.US_ASCII).let { it == "GIF87a" || it == "GIF89a" }

/** A data URL as a picture; null if it isn't one. */
internal fun decodeDataUrl(url: String): DecodedImage? {
    val comma = url.indexOf(',')
    if (!url.startsWith("data:") || comma < 0) return null
    val bytes = runCatching { Base64.decode(url.substring(comma + 1), Base64.DEFAULT) }.getOrNull() ?: return null
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() ?: return null
    return DecodedImage(bitmap, if (isGif(bytes)) ImageAnimation(bytes) else null)
}

private fun DecodedImage.loaded() = LoadedImage(bitmap, false, animation)

/**
 * The picture, with [max] at most that many pixels on its longer side, which
 * the desktop shrinks it to from bridge 14 on; older desktops send it whole.
 */
@Composable
fun rememberImage(remote: Remote, source: ImageSource, max: Int? = null): LoadedImage {
    val status by remote.status.collectAsState()
    val overview by remote.overview.collectAsState()
    val computer by remote.active.collectAsState()
    val known = overview != null
    val bridge = overview?.bridge ?: 1
    val shrunk = source !is ImageSource.Pending && max != null && bridge >= Bridge.IMAGE
    val id = scoped(source, computer) + if (shrunk) "@$max" else ""
    val online = status.state == LinkState.Online
    val cached = decoded.get(id)
    // Keyed so another picture starts from its own state, not the last one's bitmap.
    val state = key(id) {
        produceState(cached?.loaded() ?: LoadedImage(null, false), online, known) {
            if (value.bitmap != null) return@produceState
            if (source is ImageSource.Pending) {
                val url = PendingImages.lookup(source.messageId, source.index)
                val image = url?.let { withContext(Dispatchers.Default) { decodeDataUrl(it) } }
                value = image?.loaded() ?: LoadedImage(null, url == null)
                return@produceState
            }
            // Wait for the overview: a missing bridge field on an older desktop means bridge 1.
            if (!online || (max != null && !known)) return@produceState
            val client = remote.client.value ?: return@produceState
            refused -= scoped(source, computer)
            value = try {
                val url = dataUrls.load(id) {
                    val wire = source.remote()!!
                    if (shrunk) client.image(wire, max!!)
                    // Only `image` hands a preview's frame out; asked for whole, at the most it shrinks to.
                    else if (source is ImageSource.Preview) client.image(wire, LARGEST)
                    else when (source) {
                        is ImageSource.Attached ->
                            client.desktop("projectChatImage", listOf(JsonPrimitive(source.chatId), JsonPrimitive(source.imageId)))
                        is ImageSource.Read -> client.desktop(
                            "projectChatReadImage",
                            listOf(JsonPrimitive(source.chatId), JsonPrimitive(source.messageId), JsonPrimitive(source.path)),
                        )
                        is ImageSource.Pending, is ImageSource.Preview -> error("unreachable")
                    }.jsonPrimitive.content
                }
                val image = withContext(Dispatchers.Default) { decodeDataUrl(url) } ?: error("Not an image")
                decoded.put(id, image)
                image.loaded()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                refused += scoped(source, computer)
                LoadedImage(null, true)
            }
        }
    }
    return state.value
}
