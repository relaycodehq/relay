package dev.relay.android.features.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.ui.Button
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.Tone
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.listPadding
import dev.relay.android.ui.ribbon.RibbonRefreshBox

internal enum class HomeTab { Activity, Projects, Settings }

/**
 * Activity and Projects (mobile/src/screens/Browser.tsx + app/index.tsx): the phone's home
 * screen, or the sidebar beside the open thread on a wide window ([pane]), where [selected]
 * is what's open.
 */
@Composable
fun HomeScreen(
    remote: Remote,
    home: HomeServices,
    computerSeen: ComputerSeen,
    pane: Boolean,
    selected: String?,
    modifier: Modifier = Modifier,
    /** Update banners, from features that own them. */
    banners: @Composable ColumnScope.() -> Unit = {},
    /** Extra rows for the computers sheet, from features that own them; `close` puts the sheet away. */
    computerRows: @Composable (close: () -> Unit) -> Unit = {},
    /** The Settings tab's page, leaving [bottom] free under it; a wide window opens Settings in its pane instead. */
    settings: @Composable (bottom: Dp) -> Unit = {},
) {
    val navigator = LocalNavigator.current
    val active by remote.active.collectAsState()
    val iconIndex by home.icons.index.collectAsState()
    fun open(route: Route) = if (pane) navigator.openInPane(route) else navigator.push(route)
    var tab by rememberSaveable { mutableStateOf(HomeTab.Activity) }
    // A wide window keeps Settings in its pane, so unfolding on the tab goes back to the threads.
    val shown = if (pane && tab == HomeTab.Settings) HomeTab.Activity else tab
    // Back from another tab returns to the threads before it leaves the app, as Android's tabs do.
    BackHandler(enabled = shown != HomeTab.Activity) { tab = HomeTab.Activity }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val overview by remote.overview.collectAsState()
    val filter by home.filter.filter.collectAsState()

    CompositionLocalProvider(LocalProjectIconPath provides { id -> projectIconPath(iconIndex, active, id) }) {
        Screen("", modifier, topBar = false) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                Column(Modifier.fillMaxSize()) {
                    HomeHeader(
                        shown, remote, computerSeen, overview, filter, home.filter::set,
                        HomeSearch(searching, query, { searching = it; if (!it) query = "" }, { query = it }),
                        computerRows,
                    )
                    if (shown == HomeTab.Settings) settings(DOCK_ROOM)
                    else {
                        if (!searching) {
                            ConnectionLine(remote)
                            banners()
                        }
                        Browser(remote, home, selected, shown, query, ::open)
                    }
                }
                // Away while searching, or it rides up on the keyboard over the results.
                if (!searching) HomeDock(
                    shown,
                    {
                        searching = false
                        query = ""
                        if (it == HomeTab.Settings && pane) open(Route.Settings) else tab = it
                    },
                    onNew = { open(Route.NewThread()) },
                    Modifier.align(Alignment.BottomCenter),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ColumnScope.Browser(remote: Remote, home: HomeServices, selected: String?, tab: HomeTab, query: String, open: (Route) -> Unit) {
    val c = RelayTheme.colors
    val navigator = LocalNavigator.current
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val overview by remote.overview.collectAsState()
    val status by remote.status.collectAsState()
    val seen by home.seen.state.collectAsState()
    val folds by home.folds.folds.collectAsState()
    val filter by home.filter.filter.collectAsState()
    val inFront by rememberInFront()
    var refreshing by remember { mutableStateOf(false) }

    if (status.state == LinkState.Denied) {
        Column(
            Modifier.weight(1f).fillMaxWidth().padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Pair this phone again from Relay’s Settings → Phone on your computer.",
                color = c.mutedForeground,
                textAlign = TextAlign.Center,
            )
            Button("Pair again", {
                scope.launch {
                    remote.forget()
                    navigator.replace(Route.Pair())
                }
            }, Modifier.fillMaxWidth())
        }
        return
    }
    val o = overview ?: return Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
        Spinner(color = c.mutedForeground)
    }

    val draftsVersion by home.drafts.version.collectAsState()
    val drafts = remember(o, draftsVersion) { home.drafts.list(o) }
    val names = remember(o.projects) { o.projects.associate { it.id to it.name } }
    val openChat = { chat: RemoteChatSummary -> open(Route.Thread(chat.id)) }
    val triage: Triage = triage@{ chat, action ->
        try {
            val client = remote.client.value ?: error("Not connected to your computer.")
            val after = client.desktop("triageProjectChat", listOf(JsonPrimitive(chat.id), action.toJson()))
            scope.launch { runCatching { remote.refresh() } }
            after as? JsonObject
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            toasts.show("Couldn't change it", description = e.message ?: e.toString(), tone = Tone.Destructive)
            null
        }
    }
    val refresh: () -> Unit = {
        refreshing = true
        scope.launch {
            try {
                remote.refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            } finally {
                refreshing = false
            }
        }
    }

    // Search looks through every thread, as on the iPhone; the filter narrows Activity only.
    val shown = filter.current(o)

    Box(Modifier.weight(1f).fillMaxWidth()) {
        Column(Modifier.fillMaxSize()) {
            val needle = query.trim().lowercase()
            if (needle.isNotEmpty()) {
                val results = o.chats.filter { "${it.title} ${names[it.projectId] ?: ""}".lowercase().contains(needle) }
                LazyColumn(Modifier.fillMaxSize(), contentPadding = listPadding(bottom = DOCK_ROOM)) {
                    item(key = "head") { SectionHeader("Results", count = results.size) }
                    items(results, key = { it.id }) { chat ->
                        ThreadRow(chat, threadDraft(drafts, chat.id), { openChat(chat) }, project = names[chat.projectId], selected = chat.id == selected)
                    }
                    if (results.isEmpty()) item(key = "none") {
                        Text(
                            "No thread or project matches “${query.trim()}”.",
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp),
                            color = c.mutedForeground,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            } else {
                RibbonRefreshBox(refreshing, refresh, Modifier.fillMaxSize()) {
                    when (tab) {
                        HomeTab.Activity -> ActivityList(
                            chats = o.chats.filter(shown::keeps),
                            projects = o.projects,
                            drafts = drafts.filterKeys(shown::keepsDraft),
                            filtered = shown.count > 0,
                            unread = { seen.unread(it, selected, inFront) },
                            folds = folds,
                            onFold = home.folds::fold,
                            bridge = o.bridge ?: 1,
                            selected = selected,
                            onOpen = openChat,
                            onOpenDraft = { d, project -> open(Route.NewThread(projectId = project, draftKey = d.key)) },
                            onTriage = triage,
                            bottom = DOCK_ROOM,
                        )
                        HomeTab.Projects -> ProjectsList(
                            o, drafts, selected,
                            onOpenChat = openChat,
                            onOpenProject = { open(Route.Project(it.id)) },
                            onNewScratch = { open(Route.NewThread(scratch = true)) },
                            bottom = DOCK_ROOM,
                        )
                        HomeTab.Settings -> {}
                    }
                }
            }
        }
    }
}
