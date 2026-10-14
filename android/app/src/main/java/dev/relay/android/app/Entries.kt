package dev.relay.android.app

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import dev.relay.android.app.gallery.GalleryScreen
import dev.relay.android.app.screens.HomeScreen
import dev.relay.android.app.screens.PaneEmpty
import dev.relay.android.app.screens.PlaceholderScreen
import dev.relay.android.app.screens.SettingsScreen
import dev.relay.android.lib.navigation.Route

/**
 * Route → screen. A feature plugs in by replacing its placeholder line with
 * its own screen, passing what it needs from the container:
 *
 *     entry<Route.Thread> { ThreadScreen(it.id, container.remote) }
 */
fun EntryProviderScope<NavKey>.appEntries(container: AppContainer, wide: () -> Boolean) {
    entry<Route.Home> { if (wide()) PaneEmpty() else HomeScreen() }
    entry<Route.Settings> { SettingsScreen(container.prefs) }
    entry<Route.Gallery> { GalleryScreen() }

    entry<Route.Pair> { PlaceholderScreen("Pair a computer", it) }
    entry<Route.NewThread> { PlaceholderScreen("New thread", it) }
    entry<Route.Thread> { PlaceholderScreen("Thread", it) }
    entry<Route.Reply> { PlaceholderScreen("Reply", it) }
    entry<Route.SubagentRun> { PlaceholderScreen("Subagent", it) }
    entry<Route.Project> { PlaceholderScreen("Project", it) }
    entry<Route.Turn> { PlaceholderScreen("Turn", it) }
    entry<Route.Diff> { PlaceholderScreen("Diff", it) }
    entry<Route.Changes> { PlaceholderScreen("Changes", it) }
    entry<Route.Branches> { PlaceholderScreen("Branches", it) }
    entry<Route.Commit> { PlaceholderScreen("Commit", it) }
    entry<Route.Files> { PlaceholderScreen("Files", it) }
    entry<Route.File> { PlaceholderScreen("File", it) }
    entry<Route.History> { PlaceholderScreen("History", it) }
    entry<Route.Tasks> { PlaceholderScreen("Tasks", it) }
}
