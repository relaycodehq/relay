package dev.relay.android.features.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.ui.Button
import dev.relay.android.ui.Icon
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SearchField
import dev.relay.android.ui.SegmentedTabs
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.TabOption
import dev.relay.android.ui.Text
import dev.relay.android.ui.Tone
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import io.github.lyxnx.compose.ui.tablericons.outline.Settings2
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Room under the lists for the New thread button. */
private val LIST_BOTTOM = 110.dp

private enum class Tab { Activity, Projects }

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
) {
    val navigator = LocalNavigator.current
    val active by remote.active.collectAsState()
    val iconIndex by home.icons.index.collectAsState()
    fun open(route: Route) = if (pane) navigator.openInPane(route) else navigator.push(route)

    CompositionLocalProvider(LocalProjectIconPath provides { id -> projectIconPath(iconIndex, active, id) }) {
        Screen("", modifier, topBar = false) {
            Row(
                Modifier.fillMaxWidth().height(52.dp).padding(start = 16.dp, end = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ComputerSwitch(remote, computerSeen, Modifier.weight(1f), computerRows)
                IconButton(TablerIcons.Outline.Settings2, "Settings", { open(Route.Settings) })
            }
            ConnectionLine(remote)
            banners()
            Browser(remote, home, selected, ::open)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ColumnScope.Browser(remote: Remote, home: HomeServices, selected: String?, open: (Route) -> Unit) {
    val c = RelayTheme.colors
    val navigator = LocalNavigator.current
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val overview by remote.overview.collectAsState()
    val status by remote.status.collectAsState()
    val seen by home.seen.state.collectAsState()
    val folds by home.folds.folds.collectAsState()
    val inFront by rememberInFront()
    var tab by rememberSaveable { mutableStateOf(Tab.Activity) }
    var query by rememberSaveable { mutableStateOf("") }
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

    Box(Modifier.weight(1f).fillMaxWidth()) {
        Column(Modifier.fillMaxSize()) {
            SearchField(query, { query = it }, Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 6.dp), placeholder = "Search")
            val needle = query.trim().lowercase()
            if (needle.isNotEmpty()) {
                val results = o.chats.filter { "${it.title} ${names[it.projectId] ?: ""}".lowercase().contains(needle) }
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LIST_BOTTOM)) {
                    item(key = "head") {
                        Row(Modifier.fillMaxWidth().padding(end = 16.dp), verticalAlignment = Alignment.Bottom) {
                            SectionLabel("Results", Modifier.weight(1f))
                            Text("${results.size}", Modifier.padding(bottom = 6.dp), style = RelayTheme.type.xs, color = c.mutedForeground)
                        }
                    }
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
                SegmentedTabs(
                    listOf(TabOption(Tab.Activity, "Activity"), TabOption(Tab.Projects, "Projects")),
                    tab,
                    { tab = it },
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 4.dp),
                )
                PullToRefreshBox(refreshing, refresh, Modifier.fillMaxSize()) {
                    when (tab) {
                        Tab.Activity -> ActivityList(
                            chats = o.chats,
                            projects = o.projects,
                            drafts = drafts,
                            unread = { seen.unread(it, selected, inFront) },
                            folds = folds,
                            onFold = home.folds::fold,
                            bridge = o.bridge ?: 1,
                            selected = selected,
                            onOpen = openChat,
                            onOpenDraft = { d, project -> open(Route.NewThread(projectId = project, draftKey = d.key)) },
                            onTriage = triage,
                            bottom = LIST_BOTTOM,
                        )
                        Tab.Projects -> ProjectsList(
                            o, drafts, selected,
                            onOpenChat = openChat,
                            onOpenProject = { open(Route.Project(it.id)) },
                            onNewScratch = { open(Route.NewThread(scratch = true)) },
                            bottom = LIST_BOTTOM,
                        )
                    }
                }
            }
        }
        // Where the thumb is, not up in the header.
        NewThreadButton(Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 20.dp)) { open(Route.NewThread()) }
    }
}

@Composable
private fun NewThreadButton(modifier: Modifier, onClick: () -> Unit) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier.shadow(3.dp, shape).background(c.accent, shape)
            .pressable(onClick = onClick, role = Role.Button)
            .height(48.dp).padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(TablerIcons.Outline.Plus, null, tint = c.onAccent, size = 18.dp)
        Text("New thread", style = RelayTheme.type.base.copy(fontWeight = FontWeight.SemiBold), color = c.onAccent)
    }
}
