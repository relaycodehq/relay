package dev.relay.android.features.project

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import dev.relay.android.features.home.HomeServices
import dev.relay.android.features.home.LocalProjectIconPath
import dev.relay.android.features.home.ThreadRow
import dev.relay.android.features.home.projectIconPath
import dev.relay.android.features.home.threadDraft
import dev.relay.android.features.tunnel.rememberTunnels
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.projectTasks
import dev.relay.android.remote.client.projectWorkingTree
import dev.relay.android.remote.model.WorkingTree
import dev.relay.android.remote.tunnel.SiteAddress
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.RowSize
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.FileCode
import io.github.lyxnx.compose.ui.tablericons.outline.GitBranch
import io.github.lyxnx.compose.ui.tablericons.outline.GitCommit
import io.github.lyxnx.compose.ui.tablericons.outline.GitCompare
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import io.github.lyxnx.compose.ui.tablericons.outline.Terminal2
import io.github.lyxnx.compose.ui.tablericons.outline.World
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

private val operationNames = mapOf(
    "MERGE_HEAD" to "merge",
    "CHERRY_PICK_HEAD" to "cherry-pick",
    "REVERT_HEAD" to "revert",
    "rebase-merge" to "rebase",
    "rebase-apply" to "rebase",
)

/** "Merge in progress" for `MERGE_HEAD`. */
internal fun operationInProgress(operation: String) =
    (operationNames[operation] ?: operation).replaceFirstChar { it.uppercase() } + " in progress"

/** "3 changed · +40 −2 · 1 to push". */
internal fun changesLine(tree: WorkingTree) = listOfNotNull(
    if (tree.changes.isNotEmpty()) "${tree.changes.size} changed" else "No changes",
    if (tree.lines.additions > 0 || tree.lines.deletions > 0) "+${tree.lines.additions} −${tree.lines.deletions}" else null,
    if (tree.ahead > 0) "${tree.ahead} to push" else null,
    if (tree.behind > 0) "${tree.behind} to pull" else null,
).joinToString(" · ")

private class Glance(val tree: WorkingTree?, val tasks: Int?, val ports: List<Int> = emptyList())

/** The working tree (git projects only) and how many tasks run; a failed half is left out. */
private suspend fun RemoteClient.glance(id: String, git: Boolean): Glance = coroutineScope {
    suspend fun <T> quiet(block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
    val tree = async { if (git) quiet { projectWorkingTree(id) } else null }
    val tasks = async { quiet { projectTasks(id) } }
    val running = tasks.await()
    Glance(tree.await(), running?.size, running.orEmpty().flatMap { it.ports }.distinct().sorted())
}

/** A project: its checkout at a glance, its panes, and every thread in it (mobile/src/app/project/[id].tsx). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectScreen(id: String, remote: Remote, home: HomeServices) {
    val c = RelayTheme.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val overview by remote.overview.collectAsState()
    val status by remote.status.collectAsState()
    val client by remote.client.collectAsState()
    val active by remote.active.collectAsState()
    val iconIndex by home.icons.index.collectAsState()
    val project = overview?.projects?.find { it.id == id }
    val chats = overview?.chats.orEmpty().filter { it.projectId == id }
    val drafts = remember(overview) { home.drafts.list(overview) }
    val git = project != null && project.plain != true
    val online = status.state == LinkState.Online
    val tunnels = rememberTunnels(remote)
    var glance by remember { mutableStateOf<Glance?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        val live = client ?: return
        if (!online) return
        glance = live.glance(id, git)
    }
    // Fresh each time the screen comes back, e.g. after a commit: it leaves composition under another screen.
    LaunchedEffect(id, git, online, client) { load() }

    CompositionLocalProvider(LocalProjectIconPath provides { projectIconPath(iconIndex, active, it) }) {
        Screen(project?.name ?: "Project", onBack = navigator.backAction) {
            PullToRefreshBox(refreshing, {
                refreshing = true
                scope.launch {
                    try {
                        coroutineScope {
                            launch { load() }
                            launch { runCatching { remote.refresh() } }
                        }
                    } finally {
                        refreshing = false
                    }
                }
            }, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
                    item(key = "new") {
                        Entry(TablerIcons.Outline.Plus, "New thread", tint = c.accent) { navigator.push(Route.NewThread(projectId = id)) }
                    }
                    val tree = glance?.tree
                    if (git) {
                        item(key = "changes") {
                            Entry(TablerIcons.Outline.GitCompare, "Changes", tree?.let(::changesLine)) { navigator.push(Route.Changes(id)) }
                        }
                        item(key = "branch") {
                            Entry(
                                TablerIcons.Outline.GitBranch,
                                tree?.branch?.ifEmpty { null } ?: "Branch",
                                tree?.operation?.let(::operationInProgress) ?: "Switch or create a branch",
                            ) { navigator.push(Route.Branches(id)) }
                        }
                    }
                    item(key = "files") { Entry(TablerIcons.Outline.FileCode, "Files") { navigator.push(Route.Files(id)) } }
                    if (git) item(key = "history") { Entry(TablerIcons.Outline.GitCommit, "History") { navigator.push(Route.History(id)) } }
                    item(key = "tasks") {
                        val running = glance?.tasks
                        Entry(
                            TablerIcons.Outline.Terminal2,
                            "Tasks",
                            running?.let { if (it > 0) "$it running" else "Nothing running" },
                        ) { navigator.push(Route.Tasks(id)) }
                    }
                    if (tunnels) item(key = "sites") {
                        val ports = glance?.ports.orEmpty()
                        Entry(
                            TablerIcons.Outline.World,
                            "Sites",
                            if (ports.isEmpty()) "Open localhost on ${overview?.name ?: "the computer"}"
                            else ports.joinToString(", ") { "localhost:$it" },
                        ) { navigator.push(Route.Browser(ports.singleOrNull()?.let { SiteAddress(it).href })) }
                    }
                    item(key = "threads-head") { SectionHeader("Threads", Modifier.padding(horizontal = 12.dp)) }
                    items(chats, key = { it.id }) { chat ->
                        ThreadRow(chat, threadDraft(drafts, chat.id), { navigator.push(Route.Thread(chat.id)) })
                    }
                    if (chats.isEmpty()) item(key = "none") {
                        Text(
                            "No threads in this project yet.",
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
                            color = c.mutedForeground,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Entry(icon: ImageVector, title: String, subtitle: String? = null, tint: Color = RelayTheme.colors.mutedForeground, onClick: () -> Unit) =
    ListRow(
        title,
        subtitle = subtitle,
        size = RowSize.Sm,
        leading = { Icon(icon, null, tint = tint, size = 17.dp) },
        chevron = true,
        onClick = onClick,
    )
