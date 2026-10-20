package dev.relay.android.features.settings

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
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
import io.github.lyxnx.compose.ui.tablericons.outline.License
import androidx.compose.ui.platform.LocalContext
import dev.relay.android.features.dictation.DictationEngine
import dev.relay.android.features.dictation.DictationEngines

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
    Screen("Settings", onBack = nav.backAction) {
        SettingsList(remote, updates, notifications, themeMode, setTheme, scope)
    }
}

/** Settings' rows, for a page of their own or the phone's Settings tab, which keeps [bottom] free for its dock. */
@Composable
fun SettingsList(
    remote: Remote,
    updates: Updates,
    notifications: ThreadNotifications,
    themeMode: ThemeMode,
    setTheme: (ThemeMode) -> Unit,
    scope: CoroutineScope,
    bottom: Dp = 24.dp,
) {
    val nav = LocalNavigator.current
    val name = computerName(remote)
    val overview by remote.overview.collectAsState()
    // Build only the sections in view. A scrolling Column also built and measured every
    // computer, route and developer row on each tab visit, before drawing the first frame.
    LazyColumn(contentPadding = PaddingValues(start = ListInset, end = ListInset, bottom = bottom)) {
        item(key = "theme-title") { SectionHeader("Theme") }
        item(key = "theme") {
            ListGroup {
                val known = overview?.appearance != null
                themeChoices(name, known).forEach { (mode, label, hint) ->
                    ChoiceRow(label, hint, themeMode == mode) { setTheme(mode) }
                }
            }
        }

        item(key = "notifications-title") { SectionHeader("Notifications") }
        item(key = "notifications") { ListGroup { NotificationSwitchRow(notifications, name) } }

        item(key = "dictation") { DictationSection(name) }

        item(key = "app-title") { SectionHeader("App") }
        item(key = "app") {
            ListGroup {
                ListRow(
                    "Relay ${updates.installed}",
                    subtitle = "As installed; new versions come from GitHub.",
                    leadingIcon = TablerIcons.Outline.DeviceMobile,
                    subtitleLines = 3,
                )
                LatestAppRows(updates)
                ListRow(
                    "Open-source licences",
                    leadingIcon = TablerIcons.Outline.License,
                    chevron = true,
                    onClick = { nav.push(Route.Licences) },
                )
            }
        }

        item(key = "computers") { ComputersSection(remote, updates, name, scope) }
        item(key = "routes") { RouteSection(remote, name) }

        item(key = "developer-title") { SectionHeader("Developer") }
        item(key = "developer") {
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

@Composable
private fun DictationSection(name: String) {
    val engines = DictationEngines.of(LocalContext.current)
    if (!engines.available) return
    val picked by engines.picked.collectAsState()
    SectionHeader("Dictation")
    ListGroup {
        ChoiceRow("On the computer", "$name turns speech into text; the audio goes over the link.", picked == DictationEngine.Computer) {
            engines.pick(DictationEngine.Computer)
        }
        ChoiceRow("On this phone", "The phone's own speech engine. Needs no computer and sends no audio.", picked == DictationEngine.Phone) {
            engines.pick(DictationEngine.Phone)
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
