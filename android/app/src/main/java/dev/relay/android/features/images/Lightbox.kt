package dev.relay.android.features.images

import android.content.ClipData
import android.content.Context
import android.graphics.Bitmap
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
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
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberHaptics
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.Copy
import io.github.lyxnx.compose.ui.tablericons.outline.X
import java.io.File
import kotlin.math.abs
import kotlin.math.hypot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MAX_SCALE = 5f
private const val TAP_SCALE = 2.5f
// Fingers never land together: a lone finger only swipes once it clearly
// moves, so a second one has time to join it for a pinch.
private const val LONE_SLOP_DP = 24
private const val MAX_DOTS = 12

/**
 * A message's images over the whole screen, like the desktop's viewer: swipe
 * between them, pinch or double-tap to zoom, drag around once zoomed, and swipe
 * down to close. Paging waits while an image is zoomed, so a drag moves it.
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
        LaunchedEffect(pager.settledPage) { zoomed = false }

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
                    userScrollEnabled = !zoomed,
                    key = { images[it].source.toString() },
                ) { page ->
                    Page(
                        remote,
                        images[page],
                        active = page == pager.settledPage,
                        onZoom = { zoomed = it },
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
                            val file = File(dir, "copied.png")
                            file.outputStream().use { bitmap.asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
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

/** One image, fitted to the screen, that zooms around the fingers and drags within its edges. */
@Composable
private fun Page(remote: Remote, image: LightboxImage, active: Boolean, onZoom: (Boolean) -> Unit, onTap: () -> Unit) {
    val loaded = rememberImage(remote, image.source)
    val bitmap = loaded.bitmap
    val scale = remember { Animatable(1f) }
    val x = remember { Animatable(0f) }
    val y = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var wasZoomed by remember { mutableStateOf(false) }
    fun report(s: Float) {
        val now = s > 1.01f
        if (now != wasZoomed) {
            wasZoomed = now
            onZoom(now)
        }
    }
    // Swiped away from, it's fitted again for when it comes back.
    LaunchedEffect(active) {
        if (!active) {
            scale.snapTo(1f); x.snapTo(0f); y.snapTo(0f)
            wasZoomed = false
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val width = constraints.maxWidth.toFloat()
        val height = constraints.maxHeight.toFloat()
        val ratio = bitmap?.let { it.width.toFloat() / it.height } ?: 0f
        val limits = { s: Float -> imageLimits(ratio, width, height, s) }
        fun zoomTo(s: Float, toX: Float, toY: Float) {
            val edge = limits(s)
            x.updateBounds(null, null)
            y.updateBounds(null, null)
            scope.launch { scale.animateTo(s) }
            scope.launch { x.animateTo(toX.coerceIn(-edge.x, edge.x)) }
            scope.launch { y.animateTo(toY.coerceIn(-edge.y, edge.y)) }
            report(s)
        }
        // A turned or unfolded phone keeps the image within its edges.
        LaunchedEffect(ratio, width, height) {
            val edge = limits(scale.value)
            x.snapTo(x.value.coerceIn(-edge.x, edge.x))
            y.snapTo(y.value.coerceIn(-edge.y, edge.y))
        }

        if (bitmap == null) {
            if (loaded.failed) Text("This image couldn’t be loaded.", color = Color.White.copy(alpha = 0.7f), style = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
            else Spinner(color = Color.White)
            return@BoxWithConstraints
        }
        val loneSlop = with(LocalDensity.current) { LONE_SLOP_DP.dp.toPx() }
        Image(
            bitmap,
            image.name,
            Modifier
                .fillMaxSize()
                .pointerInput(width, height) {
                    detectTapGestures(
                        onTap = { onTap() },
                        onDoubleTap = { at ->
                            if (scale.value > 1.01f) zoomTo(1f, 0f, 0f)
                            // Zooms in on the point tapped.
                            else zoomTo(TAP_SCALE, -(at.x - width / 2) * (TAP_SCALE - 1), -(at.y - height / 2) * (TAP_SCALE - 1))
                        },
                    )
                }
                .pointerInput(width, height, ratio) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val tracker = VelocityTracker()
                        var pinched = false
                        var dragging = false
                        do {
                            val event = awaitPointerEvent()
                            val pressed = event.changes.count { it.pressed }
                            if (pressed >= 2) {
                                // The point between the fingers stays under them.
                                pinched = true
                                val zoom = event.calculateZoom()
                                val pan = event.calculatePan()
                                val centroid = event.calculateCentroid(useCurrent = true)
                                if (centroid != Offset.Unspecified) {
                                    val from = scale.value
                                    val s = (from * zoom).coerceIn(0.8f, MAX_SCALE)
                                    val fx = centroid.x - width / 2
                                    val fy = centroid.y - height / 2
                                    val nx = fx - (fx - x.value) * (s / from) + pan.x
                                    val ny = fy - (fy - y.value) * (s / from) + pan.y
                                    scope.launch { scale.snapTo(s); x.snapTo(nx); y.snapTo(ny) }
                                }
                                event.changes.forEach { if (it.positionChanged()) it.consume() }
                            } else if (!pinched && scale.value > 1.01f) {
                                // Zoomed, one finger drags the image instead of the pager.
                                val change = event.changes.first()
                                if (!dragging) dragging = hypot(change.position.x - down.position.x, change.position.y - down.position.y) > viewConfiguration.touchSlop
                                if (dragging) {
                                    val pan = event.calculatePan()
                                    val edge = limits(scale.value)
                                    tracker.addPosition(change.uptimeMillis, change.position)
                                    scope.launch {
                                        x.snapTo((x.value + pan.x).coerceIn(-edge.x, edge.x))
                                        y.snapTo((y.value + pan.y).coerceIn(-edge.y, edge.y))
                                    }
                                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                                }
                            } else if (!pinched) {
                                // A lone finger that clearly moves is a swipe, left to the pager or the dismiss.
                                val change = event.changes.first()
                                if (hypot(change.position.x - down.position.x, change.position.y - down.position.y) > loneSlop) break
                            }
                        } while (event.changes.any { it.pressed })
                        if (pinched) {
                            val s = scale.value.coerceIn(1f, MAX_SCALE)
                            zoomTo(s, if (s == 1f) 0f else x.value, if (s == 1f) 0f else y.value)
                        } else if (dragging) {
                            val velocity = tracker.calculateVelocity()
                            val edge = limits(scale.value)
                            x.updateBounds(-edge.x, edge.x)
                            y.updateBounds(-edge.y, edge.y)
                            scope.launch { x.animateDecay(velocity.x, exponentialDecay()) }
                            scope.launch { y.animateDecay(velocity.y, exponentialDecay()) }
                        }
                    }
                }
                .graphicsLayer {
                    translationX = x.value
                    translationY = y.value
                    scaleX = scale.value
                    scaleY = scale.value
                },
            contentScale = ContentScale.Fit,
        )
    }
}
