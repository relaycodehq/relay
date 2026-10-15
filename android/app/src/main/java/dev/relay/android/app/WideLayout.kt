package dev.relay.android.app

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.plus
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.dp
import dev.relay.android.features.home.HomeScreen
import dev.relay.android.features.updates.ComputerUpdateRow
import dev.relay.android.features.updates.UpdateBanners
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.ui.Divider
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.LocalPaneToggle
import dev.relay.android.ui.LocalScreenInsets
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.LayoutSidebar
import kotlin.math.min

private const val MIN_SIDEBAR = 240f

/** The sidebar's bounds for a window, as the Expo app's panes.tsx sets them. */
internal fun sidebarBounds(windowDp: Float): Pair<Float, Float> =
    MIN_SIDEBAR to min(560f, windowDp - 360f).coerceAtLeast(MIN_SIDEBAR)

internal fun defaultSidebarWidth(windowDp: Float): Float = (windowDp * 0.36f).coerceIn(280f, 360f)

/** Home beside the detail pane, marking what the pane has open. */
@Composable
fun HomeSidebar(container: AppContainer) {
    val selected = when (val open = LocalNavigator.current.stack.getOrNull(1)) {
        is Route.Thread -> open.id
        is Route.Project -> open.id
        else -> null
    }
    AppHome(container, pane = true, selected = selected)
}

/** Home with what other features put on it: the update banners and the computers sheet's update row. */
@Composable
fun AppHome(container: AppContainer, pane: Boolean, selected: String?) {
    HomeScreen(
        container.remote, container.home, container.computerSeen, pane = pane, selected = selected,
        banners = { UpdateBanners(container.updates, container.remote, Modifier.padding(horizontal = 16.dp)) },
        computerRows = { close -> ComputerUpdateRow(container.updates, container.remote, close) },
    )
}

/**
 * On a wide window: the sidebar (resizable by its edge, hideable from the
 * detail pane's TopBar) beside the detail pane. On a phone only the detail.
 * The detail keeps its place in the tree either way, so turning a foldable
 * doesn't rebuild the stack's screens.
 */
@Composable
fun WideLayout(
    wide: Boolean,
    prefs: ShellPrefs,
    sidebar: @Composable () -> Unit,
    detail: @Composable () -> Unit,
) {
    val density = LocalDensity.current
    val windowDp = with(density) { LocalWindowInfo.current.containerSize.width.toDp().value }
    val (minW, maxW) = sidebarBounds(windowDp)
    var live by remember { mutableStateOf<Float?>(null) }
    val width = (live ?: prefs.sidebarWidth ?: defaultSidebarWidth(windowDp)).coerceIn(minW, maxW)
    val showSidebar = wide && !prefs.sidebarHidden

    Row(Modifier.fillMaxSize()) {
        if (showSidebar) {
            Box(Modifier.width(width.dp).fillMaxHeight()) {
                CompositionLocalProvider(LocalScreenInsets provides WindowInsetsSides.Start + WindowInsetsSides.Top + WindowInsetsSides.Bottom) {
                    sidebar()
                }
                val interaction = remember { MutableInteractionSource() }
                val dragged by interaction.collectIsDraggedAsState()
                Divider(Modifier.align(Alignment.CenterEnd), color = if (dragged) RelayTheme.colors.ring else RelayTheme.colors.border, vertical = true)
                Box(
                    Modifier.align(Alignment.CenterEnd).width(12.dp).fillMaxHeight().draggable(
                        rememberDraggableState { dx -> live = ((live ?: width) + dx / density.density).coerceIn(minW, maxW) },
                        Orientation.Horizontal,
                        interactionSource = interaction,
                        onDragStopped = {
                            live?.let(prefs::saveSidebarWidth)
                            live = null
                        },
                    ),
                )
            }
        }
        Box(Modifier.weight(1f).fillMaxHeight()) {
            val toggle: (@Composable () -> Unit)? = if (!wide) null else {
                {
                    IconButton(
                        TablerIcons.Outline.LayoutSidebar,
                        if (prefs.sidebarHidden) "Show sidebar" else "Hide sidebar",
                        { prefs.hideSidebar(!prefs.sidebarHidden) },
                        tint = RelayTheme.colors.mutedForeground,
                    )
                }
            }
            CompositionLocalProvider(
                LocalScreenInsets provides if (showSidebar) WindowInsetsSides.End + WindowInsetsSides.Top + WindowInsetsSides.Bottom else LocalScreenInsets.current,
                LocalPaneToggle provides toggle,
            ) { detail() }
        }
    }
}
