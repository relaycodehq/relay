package dev.relay.android.features.images

import android.graphics.BitmapFactory
import android.util.Base64
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
private val bitmaps = object : LruCache<String, ImageBitmap>(48 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
}
// Ones the desktop refused, so the lightbox skips them as the desktop's does.
private val refused: MutableSet<String> = Collections.synchronizedSet(HashSet())

private fun scoped(source: ImageSource, computer: String?) = "$computer|$source"

/** Whether the active computer refused this picture. */
fun imageFailed(source: ImageSource, computer: String?) = scoped(source, computer) in refused

@Immutable
data class LoadedImage(val bitmap: ImageBitmap?, val failed: Boolean)

/** A data URL as a picture; null if it isn't one. */
internal fun decodeDataUrl(url: String): ImageBitmap? {
    val comma = url.indexOf(',')
    if (!url.startsWith("data:") || comma < 0) return null
    val bytes = runCatching { Base64.decode(url.substring(comma + 1), Base64.DEFAULT) }.getOrNull() ?: return null
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}

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
    val key = scoped(source, computer) + if (shrunk) "@$max" else ""
    val online = status.state == LinkState.Online
    val cached = bitmaps.get(key)
    val state by produceState(LoadedImage(cached, false), key, online, known) {
        if (value.bitmap != null) return@produceState
        if (source is ImageSource.Pending) {
            val url = PendingImages.lookup(source.messageId, source.index)
            value = LoadedImage(url?.let { withContext(Dispatchers.Default) { decodeDataUrl(it) } }, url == null)
            return@produceState
        }
        // Wait for the overview: a missing bridge field on an older desktop means bridge 1.
        if (!online || (max != null && !known)) return@produceState
        val client = remote.client.value ?: return@produceState
        refused -= scoped(source, computer)
        value = try {
            val url = dataUrls.load(key) {
                val wire = source.remote()!!
                if (shrunk) client.image(wire, max!!)
                else when (source) {
                    is ImageSource.Attached ->
                        client.desktop("projectChatImage", listOf(JsonPrimitive(source.chatId), JsonPrimitive(source.imageId)))
                    is ImageSource.Read -> client.desktop(
                        "projectChatReadImage",
                        listOf(JsonPrimitive(source.chatId), JsonPrimitive(source.messageId), JsonPrimitive(source.path)),
                    )
                    is ImageSource.Pending -> error("unreachable")
                }.jsonPrimitive.content
            }
            val bitmap = withContext(Dispatchers.Default) { decodeDataUrl(url) } ?: error("Not an image")
            bitmaps.put(key, bitmap)
            LoadedImage(bitmap, false)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            refused += scoped(source, computer)
            LoadedImage(null, true)
        }
    }
    return state
}
