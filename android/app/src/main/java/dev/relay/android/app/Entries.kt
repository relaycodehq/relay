package dev.relay.android.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.graphics.Color
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.ui.LocalNavAnimatedContentScope
import dev.relay.android.app.gallery.GalleryScreen
import dev.relay.android.app.screens.PaneEmpty
import dev.relay.android.app.screens.PlaceholderScreen
import dev.relay.android.features.composer.sendToThread
import dev.relay.android.features.files.FileScreen
import dev.relay.android.features.files.FilesScreen
import dev.relay.android.features.git.BranchesScreen
import dev.relay.android.features.git.ChangesScreen
import dev.relay.android.features.git.CommitScreen
import dev.relay.android.features.git.DiffScreen
import dev.relay.android.features.git.HistoryScreen
import dev.relay.android.features.git.TurnScreen
import dev.relay.android.features.pulls.PullScreen
import dev.relay.android.features.tasks.TasksScreen
import dev.relay.android.features.tunnel.BrowserScreen
import dev.relay.android.features.project.ProjectScreen
import dev.relay.android.features.home.ProjectCardBadge
import dev.relay.android.features.home.ProvideProjectIcons
import dev.relay.android.features.newthread.NewThreadScreen
import dev.relay.android.features.pairing.PairScreen
import dev.relay.android.features.settings.LicencesScreen
import dev.relay.android.features.settings.SettingsScreen
import dev.relay.android.features.thread.SubagentRunScreen
import dev.relay.android.features.thread.ThreadScreen
import dev.relay.android.lib.navigation.MORPHS_IN
import dev.relay.android.lib.navigation.Route
import dev.relay.android.ui.LocalScreenAnimation
import dev.relay.android.ui.theme.HextaDark
import dev.relay.android.ui.theme.RelayTheme

/**
 * Route → screen. A feature plugs in by replacing its placeholder line with
 * its own screen, passing what it needs from the container:
 *
 *     entry<Route.Thread> { ThreadScreen(it.id, container.remote) }
 */
fun EntryProviderScope<NavKey>.appEntries(container: AppContainer, wide: () -> Boolean) {
    entry<Route.Home> { if (wide()) PaneEmpty() else Animated { AppHome(container, pane = false, selected = null) } }
    entry<Route.Settings> { SettingsScreen(container.remote, container.updates, container.notifications, container.lock, container.prefs.themeMode, container.prefs::setTheme, container.scope, container.relayStop::stop) }
    entry<Route.Gallery> { GalleryScreen() }
    entry<Route.Licences> { LicencesScreen() }

    // Relay's own colours, dark on black whatever the theme: pairing another computer shouldn't
    // wear the one already paired's, and the field glows best on black.
    entry<Route.Pair> {
        RelayTheme(HextaDark.copy(background = Color.Black)) { PairScreen(container.remote, container.updates, it.link, container.relayStop::stop) }
    }
    // Home's New thread button flies into the screen as its Send; one opened from a draft or a project slides in.
    entry<Route.NewThread>(metadata = { if (it == Route.NewThread()) mapOf(MORPHS_IN to true) else emptyMap() }) { route ->
        Animated {
            ProvideProjectIcons(container.home) {
                NewThreadScreen(route, container.remote) { project, size -> ProjectCardBadge(project.id, project.name, size = size) }
            }
        }
    }
    val seen = { id: String, updated: Long ->
        container.threadSeen.markSeen(id, updated)
        container.notifications.clearThread(id)
    }
    entry<Route.Thread> { ThreadScreen(it.id, container.remote, locked = container.lock.locked.collectAsState().value, onSeen = seen) }
    entry<Route.Reply> {
        ThreadScreen(it.id, container.remote, rootId = it.rootId, locked = container.lock.locked.collectAsState().value, onSeen = seen)
    }
    entry<Route.SubagentRun> { SubagentRunScreen(it.chatId, it.agentId, it.rootId, container.remote) }
    entry<Route.Project> { ProjectScreen(it.id, container.remote, container.home) }
    entry<Route.Turn> { route ->
        TurnScreen(container.remote, route.chatId, route.messageId, !route.worktree.isNullOrEmpty()) { text, settings ->
            sendToThread(container.remote, container.app.filesDir, route.chatId, text, settings)
        }
    }
    entry<Route.Diff> { DiffScreen(container.remote, it.source) }
    entry<Route.Changes> { ChangesScreen(container.remote, it.where) }
    entry<Route.Branches> { BranchesScreen(container.remote, it.where) }
    entry<Route.Commit> { CommitScreen(container.remote, it.where, it.sha) }
    entry<Route.Files> { FilesScreen(container.remote, it.where, it.dir) }
    entry<Route.File> { FileScreen(container.remote, it.where, it.path) }
    entry<Route.History> { HistoryScreen(container.remote, it.where) }
    entry<Route.Tasks> { TasksScreen(container.remote, it.where) }
    entry<Route.Pull> { PullScreen(container.remote, it) }
    entry<Route.Browser> { BrowserScreen(container.remote, container.tunnels, container.tunnelPorts, it.url) }
}

/** Hands the screen's navigation transition to the elements in it that morph across screens. */
@Composable
private fun Animated(content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalScreenAnimation provides LocalNavAnimatedContentScope.current, content = content)
