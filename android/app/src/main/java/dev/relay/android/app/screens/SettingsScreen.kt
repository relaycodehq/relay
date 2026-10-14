package dev.relay.android.app.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.app.ShellPrefs
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.lib.navigation.Route
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.SegmentedTabs
import dev.relay.android.ui.TabOption
import dev.relay.android.ui.theme.ThemeMode
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Components

/** Placeholder Settings: the theme switch and the way into the gallery. */
@Composable
fun SettingsScreen(prefs: ShellPrefs) {
    val nav = LocalNavigator.current
    Screen("Settings", onBack = nav.backAction) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader("Appearance")
            SegmentedTabs(
                listOf(
                    TabOption(ThemeMode.Computer, "Computer"),
                    TabOption(ThemeMode.Phone, "Phone"),
                    TabOption(ThemeMode.Light, "Light"),
                    TabOption(ThemeMode.Dark, "Dark"),
                ),
                prefs.themeMode,
                prefs::setTheme,
            )
            SectionHeader("Developer")
            ListGroup {
                ListRow(
                    "Component gallery",
                    subtitle = "Every building block, light and dark",
                    leadingIcon = TablerIcons.Outline.Components,
                    chevron = true,
                    onClick = { nav.push(Route.Gallery) },
                )
            }
        }
    }
}
