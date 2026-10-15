package dev.relay.android.app.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.lib.navigation.Route
import dev.relay.android.ui.EmptyState
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Hammer

/** Stands in for a screen nobody has built yet; shows the route it got. */
@Composable
fun PlaceholderScreen(title: String, route: Route) {
    val nav = LocalNavigator.current
    Screen(title, onBack = nav.backAction) {
        EmptyState("Not built yet", description = "This screen is a placeholder in the new app.", icon = TablerIcons.Outline.Hammer)
        Text(route.toString(), Modifier.padding(horizontal = 24.dp), style = RelayTheme.type.monoSm, color = RelayTheme.colors.mutedForeground)
    }
}

/** What the detail pane shows on a wide window before anything is opened. */
@Composable
fun PaneEmpty() {
    Screen("", topBar = true) {
        EmptyState(
            "Nothing open",
            description = "Open a thread or a project from the list.",
            icon = TablerIcons.Outline.Hammer,
            fan = true,
        )
    }
}
