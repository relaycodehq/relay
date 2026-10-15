package dev.relay.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme

data class TabOption<T>(val value: T, val label: String)

private class Slots {
    val x = mutableStateMapOf<Int, Dp>()
    val w = mutableStateMapOf<Int, Dp>()
}

/** The indicator's x and width: it jumps into place the first time, then slides. */
@Composable
private fun indicator(slots: Slots, index: Int): Pair<Dp, Dp> {
    var settled by remember { mutableStateOf(false) }
    val placed = slots.w.isNotEmpty()
    LaunchedEffect(placed) {
        if (placed) {
            withFrameNanos { }
            settled = true
        }
    }
    val spec: AnimationSpec<Dp> = if (settled) tween(Motion.SLIDE, easing = Motion.EaseOutQuint) else snap()
    val x by animateDpAsState(slots.x[index] ?: 0.dp, spec, label = "tab-x")
    val w by animateDpAsState(slots.w[index] ?: 0.dp, spec, label = "tab-w")
    return x to w
}

/**
 * Hexta's segmented tabs: a muted track with a background pill that slides to
 * the chosen one. `fill` spreads the tabs across the width; otherwise they
 * hug their labels and scroll when they don't fit.
 */
@Composable
fun <T> SegmentedTabs(
    options: List<TabOption<T>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    fill: Boolean = true,
) {
    val c = RelayTheme.colors
    val slots = remember { Slots() }
    val density = LocalDensity.current
    val index = options.indexOfFirst { it.value == selected }.coerceAtLeast(0)
    val (x, w) = indicator(slots, index)
    val track = RoundedCornerShape(Radii.lg)
    val pill = RoundedCornerShape(Radii.lg - 3.dp)
    Box(
        modifier
            .then(if (fill) Modifier.fillMaxWidth() else Modifier)
            .clip(track)
            .background(c.muted)
            .padding(3.dp)
            .height(32.dp),
    ) {
        Box((if (fill) Modifier.fillMaxWidth() else Modifier.horizontalScroll(rememberScrollState())).fillMaxHeight()) {
        if (w > 0.dp) Box(
            Modifier.offset(x = x).width(w).fillMaxHeight()
                // Tailwind's `bg-input/30` scales the colour's own alpha, it doesn't replace it.
                .background(if (c.isDark) c.input.copy(alpha = c.input.alpha * 0.3f) else c.background, pill)
                .ring(if (c.isDark) c.input else c.foreground.copy(alpha = 0.05f), pill),
        )
        Row(
            (if (fill) Modifier.fillMaxWidth() else Modifier).fillMaxHeight(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            options.forEachIndexed { i, o ->
                val on = i == index
                val color by animateColorAsState(if (on) c.foreground else c.mutedForeground, label = "seg-color")
                Box(
                    Modifier
                        .then(if (fill) Modifier.weight(1f) else Modifier)
                        .fillMaxHeight()
                        .onPlaced {
                            with(density) {
                                slots.x[i] = it.positionInParent().x.toDp()
                                slots.w[i] = it.size.width.toDp()
                            }
                        }
                        .semantics { this.selected = on }
                        .pressable({ onSelect(o.value) }, role = Role.Tab, scale = false, haptic = Haptic.Selection)
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(o.label, style = RelayTheme.type.label, color = color, maxLines = 1) }
            }
        }
        }
    }
}

/** Hexta's line tabs: a hairline rule with a 2dp foreground bar sliding under the chosen tab. */
@Composable
fun <T> LineTabs(
    options: List<TabOption<T>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = RelayTheme.colors
    val slots = remember { Slots() }
    val density = LocalDensity.current
    val index = options.indexOfFirst { it.value == selected }.coerceAtLeast(0)
    val (x, w) = indicator(slots, index)
    Box(modifier.fillMaxWidth().height(40.dp)) {
        Divider(Modifier.align(Alignment.BottomStart))
        Box(Modifier.horizontalScroll(rememberScrollState()).fillMaxHeight()) {
        Row(Modifier.fillMaxHeight()) {
            options.forEachIndexed { i, o ->
                val on = i == index
                Box(
                    Modifier
                        .fillMaxHeight()
                        .onPlaced {
                            with(density) {
                                slots.x[i] = it.positionInParent().x.toDp()
                                slots.w[i] = it.size.width.toDp()
                            }
                        }
                        .semantics { this.selected = on }
                        .pressable({ onSelect(o.value) }, role = Role.Tab, scale = false, haptic = Haptic.Selection)
                        .padding(horizontal = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(o.label, style = RelayTheme.type.label, color = if (on) c.foreground else c.mutedForeground, maxLines = 1)
                }
            }
        }
        if (w > 0.dp) Box(
            Modifier.align(Alignment.BottomStart).offset(x = x).width(w).height(2.dp).background(c.foreground),
        )
        }
    }
}
