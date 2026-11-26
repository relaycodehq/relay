package dev.relay.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.AlertTriangle
import io.github.lyxnx.compose.ui.tablericons.outline.CircleCheck
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.InfoCircle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

private const val VISIBLE = 3

/** How much of each older toast shows behind the one in front. */
private val PEEK = 10.dp

/** Where a toast comes out of: the bottom end corner, or the middle of the header's edge. */
internal fun ToastEdge.origin() = when (this) {
    ToastEdge.Top -> TransformOrigin(0.5f, 0f)
    ToastEdge.Bottom -> TransformOrigin(1f, 1f)
}

/** Into the screen from its edge. */
private val ToastEdge.inward get() = if (this == ToastEdge.Top) 1f else -1f

/**
 * Draws [edge]'s stack in its box; put it last in the root so it floats over everything. Older
 * toasts peek out away from the edge, each 6% smaller.
 */
@Composable
fun ToastHost(state: ToastState, edge: ToastEdge, modifier: Modifier = Modifier) {
    val clearance by animateDpAsState(state.clearance, tween(Motion.SLIDE, easing = Motion.EaseOutQuint), label = "toast-clearance")
    val room = when (edge) {
        ToastEdge.Top -> Modifier.padding(horizontal = 16.dp)
        // Its end in line with the composers', which sit 15dp in.
        ToastEdge.Bottom -> Modifier.padding(horizontal = 15.dp, vertical = 16.dp).padding(bottom = clearance)
    }
    val corner = if (edge == ToastEdge.Top) Alignment.TopCenter else Alignment.BottomEnd
    Box(modifier.fillMaxWidth().then(room), contentAlignment = corner) {
        val shown = state.toasts.filter { it.edge == edge }.takeLast(VISIBLE)
        // As wide as the widest needs, all of them, or one behind would stick out at the sides.
        Box(Modifier.widthIn(max = 340.dp).width(IntrinsicSize.Max), contentAlignment = corner) {
            shown.forEachIndexed { i, toast ->
                key(toast.id) {
                    ToastCard(toast, depth = shown.lastIndex - i, onDismiss = { state.dismiss(toast.id) })
                }
            }
        }
    }
}

@Composable
private fun ToastCard(toast: Toast, depth: Int, onDismiss: () -> Unit) {
    val c = RelayTheme.colors
    // Only the front toast counts down; ones behind wait their turn.
    LaunchedEffect(depth == 0) {
        if (depth == 0) {
            delay(toast.durationMs)
            onDismiss()
        }
    }
    val icon = toast.tone.icon()
    Row(
        Modifier
            .fillMaxWidth()
            .arrivesFrom(toast.edge)
            .stacked(toast.edge, depth)
            .swipesAway(toast.edge, enabled = depth == 0, onDismiss = onDismiss)
            .shadow(10.dp, RelayTheme.shapes.toast, ambientColor = Color.Black.copy(alpha = 0.12f), spotColor = Color.Black.copy(alpha = 0.12f))
            .background(c.container, RelayTheme.shapes.toast)
            .ring(c.line, RelayTheme.shapes.toast)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = toast.tone.color(c))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(toast.message, style = RelayTheme.type.row)
            if (toast.description != null) Text(toast.description, style = RelayTheme.type.meta, color = c.inkSoft)
        }
        if (toast.actionLabel != null) Button(
            toast.actionLabel,
            {
                toast.onAction?.invoke()
                onDismiss()
            },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

private fun Tone.icon(): ImageVector? = when (this) {
    Tone.Success -> TablerIcons.Outline.CircleCheck
    Tone.Info -> TablerIcons.Outline.InfoCircle
    Tone.Warning, Tone.Waiting -> TablerIcons.Outline.AlertTriangle
    Tone.Destructive -> TablerIcons.Outline.CircleX
    Tone.Neutral -> null
}

/** Springs out of its edge, once. */
@Composable
private fun Modifier.arrivesFrom(edge: ToastEdge): Modifier {
    val arrival = remember { Animatable(0f) }
    val fade = remember { Animatable(0f) }
    val motion = RelayTheme.motion.hero
    LaunchedEffect(Unit) {
        launch { fade.animateTo(1f, motion.fastEffectsSpec()) }
        arrival.animateTo(1f, motion.fastSpatialSpec())
    }
    return graphicsLayer {
        val grown = 0.85f + 0.15f * arrival.value
        scaleX = grown
        scaleY = grown
        translationY = -edge.inward * (1f - arrival.value) * size.height / 4
        alpha = fade.value
        transformOrigin = edge.origin()
    }
}

/** Behind [depth] newer ones: smaller, and peeking out past them. */
@Composable
private fun Modifier.stacked(edge: ToastEdge, depth: Int): Modifier {
    val peek = with(LocalDensity.current) { PEEK.toPx() }
    val scale by animateFloatAsState(1f - 0.06f * depth, tween(Motion.SLIDE, easing = Motion.EaseOutQuint), label = "toast-scale")
    val past by animateFloatAsState(edge.inward * peek * depth, tween(Motion.SLIDE, easing = Motion.EaseOutQuint), label = "toast-past")
    return graphicsLayer {
        translationY = past
        scaleX = scale
        scaleY = scale
        transformOrigin = TransformOrigin(0.5f, if (edge == ToastEdge.Top) 1f else 0f)
    }
}

/** Swiped back where it came from (up at the top, to the end at the bottom) it goes; let go early it springs back. */
@Composable
internal fun Modifier.swipesAway(edge: ToastEdge, enabled: Boolean = true, onDismiss: () -> Unit): Modifier {
    val scope = rememberCoroutineScope()
    val drag = remember { Animatable(0f) }
    val upward = edge == ToastEdge.Top
    val outward = if (upward) -1f else 1f
    val far = with(LocalDensity.current) { if (upward) 24.dp.toPx() else 44.dp.toPx() }
    val dragged = rememberDraggableState { by ->
        val moved = (drag.value + by) * outward
        scope.launch { drag.snapTo(moved.coerceAtLeast(0f) * outward) }
    }
    return this
        .graphicsLayer {
            val length = if (upward) size.height else size.width
            if (upward) translationY = drag.value else translationX = drag.value
            alpha = 1f - (abs(drag.value) / length.coerceAtLeast(1f)).coerceIn(0f, 1f)
        }
        .draggable(
            dragged,
            if (upward) Orientation.Vertical else Orientation.Horizontal,
            enabled = enabled,
            onDragStopped = { velocity ->
                if (drag.value * outward > far || velocity * outward > 1200f) onDismiss() else drag.animateTo(0f)
            },
        )
}
