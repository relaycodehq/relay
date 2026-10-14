package dev.relay.android.app.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.ui.Button
import dev.relay.android.ui.EmptyState
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceDesktop
import io.github.lyxnx.compose.ui.tablericons.outline.Folder
import io.github.lyxnx.compose.ui.tablericons.outline.MessageCircle
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import io.github.lyxnx.compose.ui.tablericons.outline.Settings

/**
 * Placeholder Home: the pairing empty state and sample rows that exercise the
 * shell (pane on wide, push on narrow). The real list replaces all of it.
 */
@Composable
fun HomeScreen() {
    val nav = LocalNavigator.current
    Screen(
        "Relay",
        actions = {
            IconButton(TablerIcons.Outline.Plus, "New thread", { nav.push(Route.NewThread()) })
            IconButton(TablerIcons.Outline.Settings, "Settings", { nav.openInPane(Route.Settings) })
        },
    ) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            EmptyState(
                "No computer paired",
                description = "Open Relay on your computer, choose Phone, and scan the code.",
                icon = TablerIcons.Outline.DeviceDesktop,
                fan = true,
                action = { Button("Pair a computer", { nav.push(Route.Pair()) }) },
            )
            SectionHeader("Sample routes")
            ListGroup {
                ListRow("Sample thread", subtitle = "Route.Thread", leadingIcon = TablerIcons.Outline.MessageCircle, chevron = true, onClick = { nav.openInPane(Route.Thread("sample")) })
                ListRow("Sample project", subtitle = "Route.Project", leadingIcon = TablerIcons.Outline.Folder, chevron = true, onClick = { nav.openInPane(Route.Project("sample")) })
                ListRow("Settings", subtitle = "Theme and the component gallery", leadingIcon = TablerIcons.Outline.Settings, chevron = true, onClick = { nav.openInPane(Route.Settings) })
            }
            androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = RelayTheme.space.xl))
        }
    }
}
