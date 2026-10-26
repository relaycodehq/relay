package dev.relay.android.features.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.NEW_THREAD_MORPH
import dev.relay.android.ui.Icon
import dev.relay.android.ui.KeepToastsAbove
import dev.relay.android.ui.sharedButton
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.filled.LayoutGrid as LayoutGridFilled
import io.github.lyxnx.compose.ui.tablericons.filled.Messages as MessagesFilled
import io.github.lyxnx.compose.ui.tablericons.filled.Settings as SettingsFilled
import io.github.lyxnx.compose.ui.tablericons.outline.Edit
import io.github.lyxnx.compose.ui.tablericons.outline.GitPullRequest
import io.github.lyxnx.compose.ui.tablericons.outline.LayoutGrid
import io.github.lyxnx.compose.ui.tablericons.outline.Messages
import io.github.lyxnx.compose.ui.tablericons.outline.Settings

private val DOCK_HEIGHT = 64.dp
private val DOCK_GAP = 10.dp
private val ITEM_PAD = 13.dp
private val ICON = 22.dp

/** The dock's measures: full, or tightened for a narrow sidebar where four tabs and New thread wouldn't fit. */
private class DockSize(val height: Dp, val gap: Dp, val itemPad: Dp, val icon: Dp, val item: Dp)
private val FULL = DockSize(DOCK_HEIGHT, DOCK_GAP, ITEM_PAD, ICON, 48.dp)
private val TIGHT = DockSize(52.dp, 8.dp, 8.dp, 20.dp, 40.dp)

private fun DockSize.width(tabs: Int, label: Dp) =
    8.dp * 2 + (itemPad * 2 + icon) * tabs + 2.dp * (tabs - 1) + label + gap + height + 24.dp
private val LABEL_START = 8.dp
private val LABEL_END = 3.dp
private val LABELS = listOf("Threads", "Projects", "PRs", "Settings")

/** Room a list leaves under its last row so the dock doesn't cover it. */
internal val DOCK_ROOM = DOCK_HEIGHT + DOCK_GAP + 16.dp

private val grow = spring<IntSize>(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow)

/**
 * The tabs float over the list with New thread beside them, Material 3 Expressive's bar: the
 * picked tab fills in and grows its label.
 */
@Composable
internal fun HomeDock(tab: HomeTab, onTab: (HomeTab) -> Unit, onNew: () -> Unit, modifier: Modifier = Modifier) {
    KeepToastsAbove(DOCK_HEIGHT + DOCK_GAP)
    val measurer = rememberTextMeasurer()
    val style = labelStyle()
    val density = LocalDensity.current
    val widest = remember(style, density) { with(density) { LABELS.maxOf { measurer.measure(it, style).size.width }.toDp() } }
    // An unfolded Fold's list pane can't fit the picked tab's label; the tabs go icons only there,
    // and tighter still in a narrow sidebar, rather than pushing New thread off the edge.
    BoxWithConstraints(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val labels = maxWidth >= FULL.width(LABELS.size, LABEL_START + widest + LABEL_END)
        val size = if (labels || maxWidth >= FULL.width(LABELS.size, 0.dp)) FULL else TIGHT
        Dock(tab, labels, size, onTab, onNew)
    }
}

@Composable
private fun Dock(tab: HomeTab, labels: Boolean, size: DockSize, onTab: (HomeTab) -> Unit, onNew: () -> Unit) {
    val c = RelayTheme.colors
    Row(
        Modifier.padding(bottom = DOCK_GAP),
        horizontalArrangement = Arrangement.spacedBy(size.gap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val bar = c.popover
        Row(
            Modifier.height(size.height).shadow(10.dp, CircleShape).background(bar, CircleShape)
                .border(1.dp, c.border, CircleShape).padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val fill = mix(c.foreground, bar, 0.1f)
            DockItem(TablerIcons.Outline.Messages, TablerIcons.Filled.MessagesFilled, LABELS[0], tab == HomeTab.Activity, labels, fill, size) { onTab(HomeTab.Activity) }
            DockItem(TablerIcons.Outline.LayoutGrid, TablerIcons.Filled.LayoutGridFilled, LABELS[1], tab == HomeTab.Projects, labels, fill, size) { onTab(HomeTab.Projects) }
            // Tabler has no filled pull request; the picked tab's fill and label carry it.
            DockItem(TablerIcons.Outline.GitPullRequest, TablerIcons.Outline.GitPullRequest, LABELS[2], tab == HomeTab.Pulls, labels, fill, size) { onTab(HomeTab.Pulls) }
            DockItem(TablerIcons.Outline.Settings, TablerIcons.Filled.SettingsFilled, LABELS[3], tab == HomeTab.Settings, labels, fill, size) { onTab(HomeTab.Settings) }
        }
        Box(
            Modifier.sharedButton(NEW_THREAD_MORPH)
                .size(size.height).shadow(10.dp, CircleShape).clip(CircleShape)
                .background(c.send).pressable(onClick = onNew),
            contentAlignment = Alignment.Center,
        ) { Icon(TablerIcons.Outline.Edit, "New thread", tint = c.onSend, size = 24.dp) }
    }
}

@Composable
private fun labelStyle() = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold)

@Composable
private fun DockItem(icon: ImageVector, picked: ImageVector, label: String, on: Boolean, showLabel: Boolean, fill: Color, size: DockSize, onClick: () -> Unit) {
    val c = RelayTheme.colors
    val background by animateColorAsState(if (on) fill else Color.Transparent, label = "dock-fill")
    val tint by animateColorAsState(if (on) c.foreground else c.mutedForeground, label = "dock-tint")
    Row(
        Modifier.height(size.item).clip(CircleShape).background(background)
            .pressable(onClick = onClick, role = Role.Tab, scale = false)
            .semantics { selected = on }
            .padding(horizontal = size.itemPad),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Crossfade(on, label = "dock-icon") { filled ->
            Icon(if (filled) picked else icon, if (on && showLabel) null else label, tint = tint, size = size.icon)
        }
        AnimatedVisibility(
            on && showLabel,
            enter = expandHorizontally(grow) + fadeIn(),
            exit = shrinkHorizontally(grow) + fadeOut(),
        ) {
            Text(label, Modifier.padding(start = LABEL_START, end = LABEL_END), style = labelStyle(), color = tint, maxLines = 1)
        }
    }
}
