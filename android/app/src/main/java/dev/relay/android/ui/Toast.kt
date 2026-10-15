package dev.relay.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.AlertTriangle
import io.github.lyxnx.compose.ui.tablericons.outline.CircleCheck
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.InfoCircle
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

data class Toast(
    val id: Long,
    val message: String,
    val description: String? = null,
    val tone: Tone = Tone.Neutral,
    val actionLabel: String? = null,
    val onAction: (() -> Unit)? = null,
    val durationMs: Long = 4000,
)

/** The app's toasts. Newest in front; older ones peek 10dp above it, each 6% smaller. */
@Stable
class ToastState {
    val toasts = mutableStateListOf<Toast>()
    private var next = 0L

    fun show(
        message: String,
        description: String? = null,
        tone: Tone = Tone.Neutral,
        actionLabel: String? = null,
        onAction: (() -> Unit)? = null,
        durationMs: Long = if (actionLabel != null) 6000 else 4000,
    ): Long {
        val toast = Toast(next++, message, description, tone, actionLabel, onAction, durationMs)
        toasts.add(toast)
        while (toasts.size > MAX_KEPT) toasts.removeAt(0)
        return toast.id
    }

    /** "Settled · Undo": the usual shape for a reversible action. */
    fun undo(message: String, onUndo: () -> Unit): Long = show(message, actionLabel = "Undo", onAction = onUndo)

    fun dismiss(id: Long) {
        toasts.removeAll { it.id == id }
    }

    private companion object { const val MAX_KEPT = 5 }
}

val LocalToasts = staticCompositionLocalOf<ToastState> { error("No ToastHost above this screen") }

private const val VISIBLE = 3

/** Draws the stack at the bottom of its box; put it last in the root so it floats over everything. */
@Composable
fun ToastHost(state: ToastState, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), contentAlignment = Alignment.BottomCenter) {
        val shown = state.toasts.takeLast(VISIBLE)
        shown.forEachIndexed { i, toast ->
            key(toast.id) {
                ToastCard(toast, depth = shown.lastIndex - i, onDismiss = { state.dismiss(toast.id) })
            }
        }
    }
}

@Composable
private fun ToastCard(toast: Toast, depth: Int, onDismiss: () -> Unit) {
    val c = RelayTheme.colors
    val px = with(LocalDensity.current) { 10.dp.toPx() }
    val enter = remember { Animatable(0f) }
    val drag = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(Motion.SLIDE, easing = Motion.Drawer)) }
    // Only the front toast counts down; ones behind wait their turn.
    LaunchedEffect(depth == 0) {
        if (depth == 0) {
            delay(toast.durationMs)
            onDismiss()
        }
    }
    val scale by animateFloatAsState(1f - 0.06f * depth, tween(Motion.SLIDE, easing = Motion.EaseOutQuint), label = "toast-scale")
    val lift by animateFloatAsState(-px * depth, tween(Motion.SLIDE, easing = Motion.EaseOutQuint), label = "toast-lift")
    val icon: ImageVector? = when (toast.tone) {
        Tone.Success -> TablerIcons.Outline.CircleCheck
        Tone.Info -> TablerIcons.Outline.InfoCircle
        Tone.Warning, Tone.Waiting -> TablerIcons.Outline.AlertTriangle
        Tone.Destructive -> TablerIcons.Outline.CircleX
        Tone.Neutral -> null
    }
    Row(
        Modifier
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .graphicsLayer {
                val e = enter.value
                translationY = lift + (1f - e) * 40f
                translationX = drag.value
                scaleX = scale
                scaleY = scale
                alpha = e * (1f - (abs(drag.value) / (size.width.coerceAtLeast(1f))).coerceIn(0f, 1f)) * if (depth >= VISIBLE) 0f else 1f
                transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 0f)
            }
            .draggable(
                rememberDraggableState { d -> scope.launch { drag.snapTo(drag.value + d) } },
                Orientation.Horizontal,
                enabled = depth == 0,
                onDragStopped = { v ->
                    if (abs(drag.value) > 120f || abs(v) > 1200f) onDismiss()
                    else drag.animateTo(0f)
                },
            )
            .shadow(16.dp, Radii.xlShape, ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.3f))
            .background(c.popover, Radii.xlShape)
            .ring(c.border, Radii.xlShape)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = toast.tone.color(c))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(toast.message, style = RelayTheme.type.label)
            if (toast.description != null) Text(toast.description, color = c.mutedForeground)
        }
        if (toast.actionLabel != null) Button(
            toast.actionLabel,
            {
                toast.onAction?.invoke()
                onDismiss()
            },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
        )
    }
}
