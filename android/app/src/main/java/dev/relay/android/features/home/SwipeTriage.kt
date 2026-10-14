package dev.relay.android.features.home

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.AlarmSnooze
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/** How far a card goes before letting go commits it. */
private val COMMIT_AT = 96.dp
/** Horizontal travel that makes it a swipe, and vertical travel that makes it a scroll first. */
private val SWIPE_SLOP = 24.dp
private val SCROLL_SLOP = 8.dp
val SnoozeColor = Color(0xFFD99A2B)

/** A swipe's job: returns whether it went through, so a refused one slides back. */
class SwipeAction(val label: String, val run: suspend () -> Boolean)

/**
 * Activity cards triaged with one thumb (mobile/src/ui/SwipeTriage.tsx): right settles, left
 * snoozes. Vertical intent wins, and the commit is judged where the finger let go, never on a
 * projected fling, so a short flick can't triage.
 */
@Composable
fun SwipeTriage(
    settle: SwipeAction?,
    snooze: SwipeAction?,
    blocked: Boolean,
    radius: Dp,
    content: @Composable () -> Unit,
) {
    val c = RelayTheme.colors
    val density = LocalDensity.current
    val commitPx = with(density) { COMMIT_AT.toPx() }
    val swipePx = with(density) { SWIPE_SLOP.toPx() }
    val scrollPx = with(density) { SCROLL_SLOP.toPx() }
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    val back = remember { arrayOfNulls<Job>(1) }
    val committing = remember { booleanArrayOf(false) }
    DisposableEffect(Unit) { onDispose { back[0]?.cancel() } }
    val canSettle by rememberUpdatedState(settle != null && !blocked)
    val canSnooze by rememberUpdatedState(snooze != null && !blocked)
    val settleNow by rememberUpdatedState(settle)
    val snoozeNow by rememberUpdatedState(snooze)
    val shape = RoundedCornerShape(radius)
    val width = remember { floatArrayOf(Float.MAX_VALUE) }

    fun close() = scope.launch { offset.animateTo(0f, tween(Motion.BASE, easing = Motion.EaseOutQuint)) }

    fun release(distance: Float) {
        val action = when {
            distance >= commitPx && canSettle -> settleNow
            distance <= -commitPx && canSnooze -> snoozeNow
            else -> null
        }
        if (action == null) {
            close()
            return
        }
        if (committing[0]) return
        committing[0] = true
        haptics.perform(Haptic.Light)
        scope.launch {
            val done = try {
                action.run()
            } catch (_: Exception) {
                false
            }
            committing[0] = false
            if (!done) close()
            else {
                back[0]?.cancel()
                back[0] = scope.launch {
                    delay(2_500)
                    offset.animateTo(0f, tween(Motion.BASE, easing = Motion.EaseOutQuint))
                }
            }
        }
    }

    val gestures = Modifier.pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            if (!canSettle && !canSnooze) return@awaitEachGesture
            var dx = 0f
            var dy = 0f
            var swiping = false
            var past = false
            var x = offset.value
            val start = x
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (!change.pressed) {
                    if (swiping) {
                        change.consume()
                        release(x)
                    }
                    break
                }
                val delta = change.positionChange()
                dx += delta.x
                dy += delta.y
                if (!swiping) {
                    // Vertical intent wins: past a few dp up or down it's the list's scroll.
                    if (abs(dy) > scrollPx) break
                    if (abs(dx) > swipePx) {
                        swiping = true
                        back[0]?.cancel()
                    } else continue
                }
                change.consume()
                // No overshoot: the card stops where the row ends.
                x = (start + dx).coerceIn(if (canSnooze) -width[0] else 0f, if (canSettle) width[0] else 0f)
                scope.launch { offset.snapTo(x) }
                val now = (canSettle && x >= commitPx) || (canSnooze && x <= -commitPx)
                if (now != past) haptics.perform(Haptic.Selection)
                past = now
            }
        }
    }

    Box(Modifier.fillMaxWidth().onSizeChanged { width[0] = it.width.toFloat() }) {
        val x = offset.value
        val uncovered = with(density) { abs(x).toDp() }
        if (x > 0f && settle != null)
            Behind(shape, c.accentSoft, c.accent, TablerIcons.Outline.Check, settle.label, x / commitPx, uncovered, end = false)
        if (x < 0f && snooze != null)
            Behind(shape, SnoozeColor.copy(alpha = 0.22f).compositeOver(c.background), SnoozeColor, TablerIcons.Outline.AlarmSnooze, snooze.label, -x / commitPx, uncovered, end = true)
        Box(Modifier.graphicsLayer { translationX = offset.value }.then(gestures)) { content() }
    }
}

/** What a swipe uncovers: the strip the card left, its label by the edge it comes from. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.Behind(
    shape: RoundedCornerShape,
    fill: Color,
    tint: Color,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    progress: Float,
    width: Dp,
    end: Boolean,
) {
    val edge = if (end) Alignment.CenterEnd else Alignment.CenterStart
    Box(Modifier.matchParentSize()) {
        Box(Modifier.align(edge).width(width).fillMaxHeight().clip(shape).background(fill), contentAlignment = edge) {
        Row(
            Modifier.wrapContentWidth(if (end) Alignment.End else Alignment.Start, unbounded = true).padding(horizontal = 18.dp)
                .graphicsLayer { alpha = 0.35f + 0.65f * progress.coerceIn(0f, 1f) },
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, tint = tint, size = 18.dp)
            Text(label, style = RelayTheme.type.label, color = tint, maxLines = 1)
        }
        }
    }
}
