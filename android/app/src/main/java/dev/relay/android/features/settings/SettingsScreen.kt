package dev.relay.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.features.notifications.NotificationSwitchRow
import dev.relay.android.features.notifications.ThreadNotifications
import dev.relay.android.features.updates.LatestAppRows
import dev.relay.android.features.updates.Updates
import dev.relay.android.features.updates.computerName
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.theme.RelayTheme
import dev.relay.android.ui.theme.ThemeMode
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.Components
import kotlinx.coroutines.CoroutineScope
import dev.relay.android.ui.ListInset
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceMobile

/**
 * mobile/src/app/settings.tsx: theme, notifications, this app's version and
 * updates, the paired computers, and how to reach the one in use.
 */
@Composable
fun SettingsScreen(
    remote: Remote,
    updates: Updates,
    notifications: ThreadNotifications,
    themeMode: ThemeMode,
    setTheme: (ThemeMode) -> Unit,
    /** Outlives this screen, for a switch or unpair that navigates away. */
    scope: CoroutineScope,
) {
    val nav = LocalNavigator.current
    val name = computerName(remote)
    val overview by remote.overview.collectAsState()
    Screen("Settings", onBack = nav.backAction) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = ListInset).padding(bottom = 24.dp)) {
            SectionHeader("Theme")
            ListGroup {
                val known = overview?.appearance != null
                themeChoices(name, known).forEach { (mode, label, hint) ->
                    ChoiceRow(label, hint, themeMode == mode) { setTheme(mode) }
                }
            }

            SectionHeader("Notifications")
            ListGroup { NotificationSwitchRow(notifications, name) }

            SectionHeader("App")
            ListGroup {
                ListRow(
                    "Relay ${updates.installed}",
                    subtitle = "As installed; new versions come from GitHub.",
                    leadingIcon = TablerIcons.Outline.DeviceMobile,
                    subtitleLines = 3,
                )
                LatestAppRows(updates)
            }

            ComputersSection(remote, updates, name, scope)
            RouteSection(remote, name)

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

private fun themeChoices(name: String, known: Boolean) = listOf(
    Triple(
        ThemeMode.Computer, "Match $name",
        if (known) "Its theme, light or dark as it is set there." else "Relay's theme until your computer shares its own.",
    ),
    Triple(ThemeMode.Phone, "Follow this phone", "The same theme, light or dark with the phone."),
    Triple(ThemeMode.Light, "Light", "The theme's light colours."),
    Triple(ThemeMode.Dark, "Dark", "The theme's dark colours."),
)

/** A row of a pick-one list: a check on the chosen one. */
@Composable
internal fun ChoiceRow(label: String, hint: String, chosen: Boolean, onClick: () -> Unit) {
    ListRow(
        label,
        subtitle = hint,
        subtitleLines = 3,
        trailing = if (chosen) ({
            Icon(TablerIcons.Outline.Check, null, Modifier.size(16.dp), tint = RelayTheme.colors.primary)
        }) else null,
        onClick = onClick,
    )
}
