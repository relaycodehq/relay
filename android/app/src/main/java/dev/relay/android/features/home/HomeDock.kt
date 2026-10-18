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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.filled.LayoutGrid as LayoutGridFilled
import io.github.lyxnx.compose.ui.tablericons.filled.Messages as MessagesFilled
import io.github.lyxnx.compose.ui.tablericons.filled.Settings as SettingsFilled
import io.github.lyxnx.compose.ui.tablericons.outline.Edit
import io.github.lyxnx.compose.ui.tablericons.outline.LayoutGrid
import io.github.lyxnx.compose.ui.tablericons.outline.Messages
import io.github.lyxnx.compose.ui.tablericons.outline.Settings

private val DOCK_HEIGHT = 64.dp
private val DOCK_GAP = 10.dp

/** Room a list leaves under its last row so the dock doesn't cover it. */
internal val DOCK_ROOM = DOCK_HEIGHT + DOCK_GAP + 16.dp

private val grow = spring<IntSize>(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow)

/**
 * The tabs float over the list with New thread beside them, Material 3 Expressive's bar: the
 * picked tab fills in and grows its label.
 */
@Composable
internal fun HomeDock(tab: HomeTab, onTab: (HomeTab) -> Unit, onNew: () -> Unit, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    Row(
        modifier.padding(bottom = DOCK_GAP),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val bar = c.popover
        Row(
            Modifier.height(DOCK_HEIGHT).shadow(10.dp, CircleShape).background(bar, CircleShape)
                .border(1.dp, c.border, CircleShape).padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val fill = mix(c.foreground, bar, 0.1f)
            DockItem(TablerIcons.Outline.Messages, TablerIcons.Filled.MessagesFilled, "Threads", tab == HomeTab.Activity, fill) { onTab(HomeTab.Activity) }
            DockItem(TablerIcons.Outline.LayoutGrid, TablerIcons.Filled.LayoutGridFilled, "Projects", tab == HomeTab.Projects, fill) { onTab(HomeTab.Projects) }
            DockItem(TablerIcons.Outline.Settings, TablerIcons.Filled.SettingsFilled, "Settings", tab == HomeTab.Settings, fill) { onTab(HomeTab.Settings) }
        }
        Box(
            Modifier.size(DOCK_HEIGHT).shadow(10.dp, CircleShape).clip(CircleShape)
                .background(c.primary).pressable(onClick = onNew),
            contentAlignment = Alignment.Center,
        ) { Icon(TablerIcons.Outline.Edit, "New thread", tint = c.onPrimary, size = 24.dp) }
    }
}

@Composable
private fun DockItem(icon: ImageVector, picked: ImageVector, label: String, on: Boolean, fill: Color, onClick: () -> Unit) {
    val c = RelayTheme.colors
    val background by animateColorAsState(if (on) fill else Color.Transparent, label = "dock-fill")
    val tint by animateColorAsState(if (on) c.foreground else c.mutedForeground, label = "dock-tint")
    Row(
        Modifier.height(48.dp).clip(CircleShape).background(background)
            .pressable(onClick = onClick, role = Role.Tab, scale = false)
            .semantics { selected = on }
            .padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Crossfade(on, label = "dock-icon") { filled ->
            Icon(if (filled) picked else icon, if (on) null else label, tint = tint, size = 22.dp)
        }
        AnimatedVisibility(
            on,
            enter = expandHorizontally(grow) + fadeIn(),
            exit = shrinkHorizontally(grow) + fadeOut(),
        ) {
            Text(label, Modifier.padding(start = 8.dp, end = 3.dp), style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), color = tint, maxLines = 1)
        }
    }
}
