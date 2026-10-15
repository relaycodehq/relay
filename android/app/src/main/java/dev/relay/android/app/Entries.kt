package dev.relay.android.app

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
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
import dev.relay.android.features.tasks.TasksScreen
import dev.relay.android.features.tunnel.BrowserScreen
import dev.relay.android.features.project.ProjectScreen
import dev.relay.android.features.home.ProjectCardBadge
import dev.relay.android.features.home.ProvideProjectIcons
import dev.relay.android.features.newthread.NewThreadScreen
import dev.relay.android.features.pairing.PairScreen
import dev.relay.android.features.settings.SettingsScreen
import dev.relay.android.features.thread.SubagentRunScreen
import dev.relay.android.features.thread.ThreadScreen
import dev.relay.android.lib.navigation.Route

/**
 * Route → screen. A feature plugs in by replacing its placeholder line with
 * its own screen, passing what it needs from the container:
 *
 *     entry<Route.Thread> { ThreadScreen(it.id, container.remote) }
 */
fun EntryProviderScope<NavKey>.appEntries(container: AppContainer, wide: () -> Boolean) {
    entry<Route.Home> { if (wide()) PaneEmpty() else AppHome(container, pane = false, selected = null) }
    entry<Route.Settings> { SettingsScreen(container.remote, container.updates, container.notifications, container.prefs.themeMode, container.prefs::setTheme, container.scope) }
    entry<Route.Gallery> { GalleryScreen() }

    entry<Route.Pair> { PairScreen(container.remote, it.link) }
    entry<Route.NewThread> { route ->
        ProvideProjectIcons(container.home) {
            NewThreadScreen(route, container.remote) { project, size -> ProjectCardBadge(project.id, project.name, size = size) }
        }
    }
    val seen = { id: String, updated: Long ->
        container.threadSeen.markSeen(id, updated)
        container.notifications.clearThread(id)
    }
    entry<Route.Thread> { ThreadScreen(it.id, container.remote, onSeen = seen) }
    entry<Route.Reply> { ThreadScreen(it.id, container.remote, rootId = it.rootId, onSeen = seen) }
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
    entry<Route.Browser> { BrowserScreen(container.remote, container.tunnels, container.tunnelPorts, it.url) }
}
