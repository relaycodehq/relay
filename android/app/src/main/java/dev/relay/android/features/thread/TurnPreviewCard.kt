package dev.relay.android.features.thread

// The desktop's TurnPreview (src/features/browser/TurnPreview.tsx): the page a
// turn's agent left the thread's preview on, under its answer, as a small
// browser strip over the frame it kept. The frame opens in the lightbox. The
// phone can't reach the computer's own addresses, so a local page is only text.

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.relay.android.features.images.ImageSource
import dev.relay.android.features.images.Lightbox
import dev.relay.android.features.images.LightboxImage
import dev.relay.android.features.images.rememberImage
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.model.TurnPreview
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.features.tunnel.rememberTunnels
import dev.relay.android.remote.tunnel.LocalUrls
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ExternalLink
import io.github.lyxnx.compose.ui.tablericons.outline.World
import java.net.URI

// Fixed, so loading the frame doesn't move the thread; cropped from the top, as on the desktop.
private val FRAME_HEIGHT = 200.dp
private val FADE = 56.dp
private val LOCAL_HOSTS = setOf("localhost", "0.0.0.0", "::1")

internal fun shortUrl(url: String) = url.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")

/** A web page the phone can open itself: not one on the computer's own addresses. */
internal fun opensOnPhone(url: String): Boolean {
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    if (uri.scheme?.lowercase() !in setOf("http", "https")) return false
    val host = uri.host?.lowercase()?.removePrefix("[")?.removeSuffix("]") ?: return false
    return host !in LOCAL_HOSTS && !host.endsWith(".localhost") && !host.startsWith("127.")
}

@Composable
fun TurnPreviewCard(chatId: String, messageId: String, preview: TurnPreview) {
    val remote = LocalThreadRemote.current ?: return
    val bridge = remote.overview.collectAsState().value?.bridge ?: 1
    if (bridge < Bridge.PREVIEW) return
    val c = RelayTheme.colors
    val uri = LocalUriHandler.current
    val chrome = c.foreground.copy(alpha = 0.03f).compositeOver(c.background)
    val edge = c.foreground.copy(alpha = 0.14f)
    val short = shortUrl(preview.url)
    // The computer's own localhost opens here through the tunnel, where the desktop has one.
    val tunnels = rememberTunnels(remote)
    val local = remember(preview.url) { LocalUrls.link(preview.url) != null }
    val link = remember(preview.url, tunnels) { opensOnPhone(preview.url) || (local && tunnels) }
    val open = { runCatching { uri.openUri(preview.url) }; Unit }
    // The frame hangs off the bar's lower edge; without one the bar is a card of its own.
    val bar = if (preview.shot == true) RoundedCornerShape(topStart = 9.dp, topEnd = 9.dp) else RoundedCornerShape(9.dp)
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clip(bar).background(chrome).ring(edge, bar).padding(6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            val field = RoundedCornerShape(6.dp)
            Row(
                Modifier.weight(1f).height(30.dp).clip(field).background(c.background)
                    .ring(c.foreground.copy(alpha = 0.08f), field)
                    .then(if (link) Modifier.pressable(open, scale = false) else Modifier)
                    .padding(horizontal = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(TablerIcons.Outline.World, null, size = 12.dp, tint = c.mutedForeground)
                Text(short, style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
            }
            if (link) Box(Modifier.pressable(open).padding(7.dp)) {
                Icon(TablerIcons.Outline.ExternalLink, if (local) "Open here through your computer" else "Open in your browser", size = 14.dp, tint = c.mutedForeground)
            }
        }
        if (preview.shot == true) Frame(chatId, messageId, preview.title.ifEmpty { short }, edge)
    }
}

@Composable
private fun Frame(chatId: String, messageId: String, name: String, edge: Color) {
    val remote = LocalThreadRemote.current ?: return
    val c = RelayTheme.colors
    val source = remember(chatId, messageId) { ImageSource.Preview(chatId, messageId) }
    val wide = with(LocalDensity.current) { LocalConfiguration.current.screenWidthDp.dp.roundToPx() }
    val loaded = rememberImage(remote, source, wide)
    if (loaded.failed) return
    var viewing by remember { mutableStateOf(false) }
    val bitmap = loaded.bitmap
    Box(
        Modifier.fillMaxWidth().height(FRAME_HEIGHT)
            .then(if (bitmap != null) Modifier.pressable({ viewing = true }, role = Role.Image, scale = false) else Modifier)
            // The sides fade out with the frame, so its lower edge never shows.
            .drawWithContent {
                drawContent()
                val line = 1.dp.toPx()
                drawLine(edge, Offset(line / 2, 0f), Offset(line / 2, size.height), line)
                drawLine(edge, Offset(size.width - line / 2, 0f), Offset(size.width - line / 2, size.height), line)
                val fade = FADE.toPx()
                drawRect(
                    Brush.verticalGradient(listOf(c.background.copy(alpha = 0f), c.background), startY = size.height - fade, endY = size.height),
                    topLeft = Offset(0f, size.height - fade),
                    size = Size(size.width, fade),
                )
            },
    ) {
        if (bitmap != null) Image(
            bitmap, "Preview of $name", Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop, alignment = Alignment.TopCenter,
        )
    }
    if (viewing) Lightbox(remote, listOf(LightboxImage(source, name)), 0) { viewing = false }
}
