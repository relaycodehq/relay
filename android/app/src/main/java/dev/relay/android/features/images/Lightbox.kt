package dev.relay.android.features.images

import android.content.ClipData
import android.content.Context
import android.graphics.Bitmap
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import dev.relay.android.remote.Remote
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.Icon
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberHaptics
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.Copy
import io.github.lyxnx.compose.ui.tablericons.outline.X
import java.io.File
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MAX_DOTS = 12

/**
 * A message's images over the whole screen, like the desktop's viewer: swipe
 * between them, pinch or double-tap to zoom, drag around once zoomed, and swipe
 * down to close. A zoomed image pans until a new swipe starts at its edge.
 */
@Composable
fun Lightbox(remote: Remote, images: List<LightboxImage>, index: Int, onClose: () -> Unit) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val pager = rememberPagerState(index.coerceIn(0, (images.size - 1).coerceAtLeast(0))) { images.size }
        var zoomed by remember { mutableStateOf(false) }
        // A tap hides the bar, for an image whose top it covers.
        var bar by remember { mutableStateOf(true) }
        val drop = remember { Animatable(0f) }
        val scope = rememberCoroutineScope()
        val density = LocalDensity.current

        Box(Modifier.fillMaxSize()) {
            val fade = 1f - 0.8f * (abs(drop.value) / with(density) { 400.dp.toPx() }).coerceIn(0f, 1f)
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = fade }.background(Color.Black))
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer { translationY = drop.value }
                    .pointerInput(zoomed) {
                        if (zoomed) return@pointerInput
                        val tracker = VelocityTracker()
                        detectVerticalDragGestures(
                            onDragStart = { tracker.resetTracking() },
                            onVerticalDrag = { change, amount ->
                                tracker.addPosition(change.uptimeMillis, change.position)
                                change.consume()
                                scope.launch { drop.snapTo(drop.value + amount) }
                            },
                            onDragEnd = {
                                val speed = abs(tracker.calculateVelocity().y) / density.density
                                if (abs(drop.value) / density.density > 120 || speed > 1000) onClose()
                                else scope.launch { drop.animateTo(0f, spring()) }
                            },
                            onDragCancel = { scope.launch { drop.animateTo(0f, spring()) } },
                        )
                    },
            ) {
                HorizontalPager(
                    pager,
                    Modifier.fillMaxSize(),
                    key = { images[it].source.toString() },
                ) { page ->
                    LightboxPage(
                        remote,
                        images[page],
                        active = page == pager.settledPage,
                        onZoom = { zoomed = it },
                        onPinchStart = { pager.requestScrollToPage(page) },
                        onTap = { bar = !bar },
                    )
                }
            }
            val current = images.getOrNull(pager.currentPage)
            AnimatedVisibility(bar, enter = fadeIn(tween(150)), exit = fadeOut(tween(150))) {
                Bar(
                    remote,
                    current,
                    count = if (images.size > 1) "${pager.currentPage + 1} of ${images.size}" else null,
                    onClose = onClose,
                )
            }
            if (images.size in 2..MAX_DOTS) {
                AnimatedVisibility(
                    bar,
                    Modifier.align(Alignment.BottomCenter),
                    enter = fadeIn(tween(150)),
                    exit = fadeOut(tween(150)),
                ) { Dots(images.size, pager.currentPage) }
            }
        }
    }
}

@Composable
private fun Bar(remote: Remote, image: LightboxImage?, count: String?, onClose: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.Black.copy(alpha = 0.45f))
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 20.dp, end = 16.dp, top = 8.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                image?.name.orEmpty(),
                style = androidx.compose.ui.text.TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
                color = Color.White,
                maxLines = 1,
            )
            if (count != null) Text(count, style = androidx.compose.ui.text.TextStyle(fontSize = 13.sp), color = Color.White.copy(alpha = 0.7f))
        }
        if (image != null) CopyImage(remote, image.source)
        Box(Modifier.pressable(onClose).padding(4.dp)) { Icon(TablerIcons.Outline.X, "Close", tint = Color.White, size = 22.dp) }
    }
}

/** Where the swipe is, down by the thumb; past [MAX_DOTS] only the bar's count says. */
@Composable
private fun Dots(count: Int, index: Int) {
    Row(
        Modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(bottom = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { i ->
            // Outlined, so they show over a white screenshot as on black.
            val on = i == index
            Box(
                Modifier
                    .size(if (on) 9.dp else 7.dp)
                    .border(if (on) 1.5.dp else 1.dp, Color.Black.copy(alpha = if (on) 0.6f else 0.3f), CircleShape)
                    .background(if (on) Color.White else Color.White.copy(alpha = 0.4f), CircleShape),
            )
        }
    }
}

/** The FileProvider authority the copied picture is shared through. */
private fun Context.imageAuthority() = "$packageName.images"

private fun Context.canShareImages() =
    runCatching { packageManager.resolveContentProvider(imageAuthority(), 0) != null }.getOrDefault(false)

/** Puts the image on the clipboard to paste into another app. */
@Composable
private fun CopyImage(remote: Remote, source: ImageSource) {
    val context = LocalContext.current
    if (!remember(context) { context.canShareImages() }) return
    // The page already fetched it; this finds it in the cache.
    val loaded = rememberImage(remote, source)
    val bitmap = loaded.bitmap ?: return
    val clipboard = LocalClipboard.current
    val toasts = LocalToasts.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var copied by remember(source) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1_500)
            copied = false
        }
    }
    Box(
        Modifier
            .pressable({
                scope.launch {
                    try {
                        val uri = withContext(Dispatchers.IO) {
                            val dir = File(context.cacheDir, "images").apply { mkdirs() }
                            // A GIF is copied as it is, so it still plays where it's pasted.
                            val gif = loaded.animation?.bytes
                            val file = File(dir, if (gif != null) "copied.gif" else "copied.png")
                            if (gif != null) file.writeBytes(gif)
                            else file.outputStream().use { bitmap.asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
                            FileProvider.getUriForFile(context, context.imageAuthority(), file)
                        }
                        clipboard.setClipEntry(ClipEntry(ClipData.newUri(context.contentResolver, "Image", uri)))
                        haptics.perform(Haptic.Selection)
                        copied = true
                    } catch (e: Exception) {
                        toasts.show("Couldn't copy the image", e.message)
                    }
                }
            })
            .padding(4.dp),
    ) {
        Icon(if (copied) TablerIcons.Outline.Check else TablerIcons.Outline.Copy, if (copied) "Image copied" else "Copy image", tint = Color.White, size = 20.dp)
    }
}
