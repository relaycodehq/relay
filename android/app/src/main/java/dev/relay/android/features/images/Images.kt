package dev.relay.android.features.images

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.Remote
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.RelayTheme

private val THUMB = 88.dp
private const val ANSWER_HEIGHT = 420
private val TRACE_HEIGHT = 88.dp
// Wider or taller than this, a picture is cropped to it rather than squeezed or stretched.
private const val TRACE_MIN_RATIO = 0.75f
private const val TRACE_MAX_RATIO = 2f

@Composable
private fun pixels(points: Dp): Int = with(LocalDensity.current) { points.roundToPx() }

/** A message's image row: pasted images, and the ones its agent read but didn't show. */
@Composable
fun MessageImages(
    remote: Remote,
    images: List<LightboxImage>,
    onOpen: (ImageSource) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (images.isEmpty()) return
    Row(modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        images.forEach { Thumb(remote, it) { onOpen(it.source) } }
    }
}

@Composable
private fun Thumb(remote: Remote, image: LightboxImage, onClick: () -> Unit) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(10.dp)
    // Covers a square, so its shorter side is what has to fill it.
    val loaded = rememberImage(remote, image.source, pixels(THUMB * 2))
    Box(
        Modifier
            .size(THUMB)
            .clip(shape)
            .background(c.muted)
            .ring(c.border, shape)
            .pressable(onClick, role = Role.Image),
        contentAlignment = Alignment.Center,
    ) {
        val bitmap = loaded.bitmap
        if (bitmap != null) Image(bitmap, image.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else if (!loaded.failed) Spinner(color = c.mutedForeground)
    }
}

/**
 * The picture a trace row's agent looked at, under the row and big enough to
 * tell what it is; tapped, it opens. Its height is held from the start, so a
 * running call, the fetch and the decode don't move the trace.
 */
@Composable
fun ReadPreview(
    remote: Remote,
    source: ImageSource.Read,
    name: String,
    done: Boolean,
    onOpen: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(8.dp)
    val loaded = if (done) rememberImage(remote, source, pixels(TRACE_HEIGHT * TRACE_MAX_RATIO)) else null
    val bitmap = loaded?.bitmap
    val ratio = bitmap?.let { it.width.toFloat() / it.height } ?: (4f / 3)
    Box(
        modifier
            .padding(top = 2.dp, bottom = 6.dp)
            .height(TRACE_HEIGHT)
            .width(TRACE_HEIGHT * ratio.coerceIn(TRACE_MIN_RATIO, TRACE_MAX_RATIO))
            .clip(shape)
            .background(c.muted)
            .ring(c.border, shape)
            .then(if (done && onOpen != null) Modifier.pressable(onOpen, role = Role.Image, scale = false) else Modifier),
    ) {
        if (bitmap != null) Image(bitmap, name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
    }
}

/** A finished image read's row icon on the live row, which can't grow: the picture, icon-sized. */
@Composable
fun ReadSwatch(remote: Remote, source: ImageSource, modifier: Modifier = Modifier) {
    val loaded = rememberImage(remote, source, pixels(TRACE_HEIGHT * TRACE_MAX_RATIO))
    Box(modifier.size(14.dp).clip(RoundedCornerShape(3.dp)).background(RelayTheme.colors.muted)) {
        loaded.bitmap?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
    }
}

/** A reserved image frame: fetching, decoding and failures never move the paragraphs below it. */
@Composable
fun AnswerImage(
    remote: Remote,
    source: ImageSource,
    alt: String,
    onOpen: (ImageSource) -> Unit,
    modifier: Modifier = Modifier,
    ready: Boolean = true,
) {
    val screen = LocalConfiguration.current.screenWidthDp
    // A streaming answer reserves the same frame, but the desktop only serves saved image references.
    val loaded = if (ready) rememberImage(remote, source, pixels(maxOf(ANSWER_HEIGHT, screen).dp)) else LoadedImage(null, false)
    val label = alt.ifEmpty { if (source is ImageSource.Read) source.path.substringAfterLast('/') else "Image" }
    AnswerImageFrame(loaded, label, { onOpen(source) }, modifier)
}

@Composable
internal fun AnswerImageFrame(loaded: LoadedImage, label: String, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val bitmap = loaded.bitmap
    val shape = RoundedCornerShape(10.dp)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        Box(
            Modifier.fillMaxWidth().height(minOf(maxWidth, ANSWER_HEIGHT.dp))
                .clip(shape).background(RelayTheme.colors.muted).ring(RelayTheme.colors.border, shape)
                .then(if (bitmap != null) Modifier.pressable(onOpen, role = Role.Image, scale = false) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            if (bitmap != null) Image(bitmap, label, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            else if (loaded.failed) Text("Image unavailable", color = RelayTheme.colors.mutedForeground)
            else Spinner(color = RelayTheme.colors.mutedForeground)
        }
    }
}
