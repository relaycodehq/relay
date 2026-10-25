package dev.relay.android.features.pulls

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.features.git.EmptyNote
import dev.relay.android.features.git.LoadFailed
import dev.relay.android.features.git.Loading
import dev.relay.android.features.git.rememberLive
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.SegmentedTabs
import dev.relay.android.ui.TabOption
import dev.relay.android.ui.Text
import dev.relay.android.ui.listPadding
import dev.relay.android.ui.ribbon.RibbonRefreshBox
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.launch

/** The key Home's sidebar marks an open PR by. */
fun pullSelection(route: Route.Pull) = pullKey(dev.relay.android.remote.model.PullRef(route.owner, route.name, route.number, route.server))

fun pullRoute(p: ListedPull) = Route.Pull(p.ref.owner, p.ref.name, p.ref.number, p.ref.server)

/**
 * Home's Pull requests tab: what asks for your review, what's assigned to you and your own,
 * across every host the computer is signed in to. Your own say what they wait on.
 */
@Composable
fun PullsList(remote: Remote, query: String, selected: String?, bottom: Dp, open: (Route) -> Unit) {
    val model = viewModel(key = "pulls") { PullsModel(remote) }
    val pulls by model.pulls.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val signedOut by model.signedOut.collectAsStateWithLifecycle()
    val signals by model.signals.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val failed by model.failed.collectAsStateWithLifecycle()
    val state by model.state.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    val scope = rememberCoroutineScope()
    // Hosts don't push; look again whenever the link comes back or the app comes to the front.
    LaunchedEffect(live) { if (live) model.load() }

    Column(Modifier.fillMaxSize()) {
        SegmentedTabs(
            STATES,
            state,
            { scope.launch { model.show(it) } },
            Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 6.dp),
            primary = true,
        )
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Pulls(model, query, selected, bottom, open, pulls, error, pending, failed, signals, signedOut, state)
        }
    }
}

private val STATES = listOf(TabOption("open", "Open"), TabOption("closed", "Closed"), TabOption("all", "All"))

@Composable
private fun Pulls(
    model: PullsModel,
    query: String,
    selected: String?,
    bottom: Dp,
    open: (Route) -> Unit,
    pulls: List<ListedPull>?,
    error: String?,
    pending: Set<String>,
    failed: Map<String, String>,
    signals: Map<String, PullSignals>,
    signedOut: Boolean,
    state: String,
) {
    val c = RelayTheme.colors
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val all = pulls
    when {
        all == null && error != null -> return LoadFailed(error, { model.load() })
        // Only until the first search answers: an empty answer from one host is still an answer.
        all == null -> return Loading()
    }
    val needle = query.trim().lowercase()
    val shown = all!!.filter { needle.isEmpty() || "${it.hit.title} ${it.hit.repository.name} ${it.hit.number} ${it.hit.user.login}".lowercase().contains(needle) }
    val groups = listOf(
        (if (state == "open") "Needs your review" else "Asked for your review") to shown.filter { it.relation == Relation.Review },
        "Assigned to you" to shown.filter { it.relation == Relation.Assigned },
        // Yours that wait on you come first: failing CI or change requests.
        "Yours" to shown.filter { it.relation == Relation.Mine }.sortedByDescending { signalText(signals[it.key])?.second == true },
    ).filter { it.second.isNotEmpty() }

    RibbonRefreshBox(refreshing, {
        refreshing = true
        scope.launch {
            try {
                model.load()
            } finally {
                refreshing = false
            }
        }
    }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = listPadding(bottom = bottom)) {
            // A slow or failed host says so above what the others found.
            if (pending.isNotEmpty()) item(key = "waiting") {
                Text(
                    "Waiting for ${pending.map(::hostName).distinct().joinToString(", ")}…",
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                    style = RelayTheme.type.xs,
                    color = c.mutedForeground,
                )
            }
            for ((server, why) in failed) item(key = "failed:$server") {
                Text(
                    "Couldn't reach ${hostName(server)}: $why",
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                    style = RelayTheme.type.xs,
                    color = c.destructive,
                    maxLines = 2,
                )
            }
            if (signedOut) item(key = "signed-out") {
                EmptyNote("Sign in to GitHub (`gh auth login`), Gitea or Azure DevOps on your computer to see pull requests here.", Modifier.fillMaxWidth())
            } else if (groups.isEmpty() && pending.isEmpty()) item(key = "none") {
                Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                    Text(
                        if (needle.isEmpty()) when (state) {
                            "open" -> "No open pull requests need you."
                            "closed" -> "No closed pull requests of yours."
                            else -> "No pull requests of yours."
                        } else "No pull request matches “${query.trim()}”.",
                        color = c.mutedForeground,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            for ((label, rows) in groups) {
                item(key = "head:$label") { SectionHeader(label, count = rows.size) }
                items(rows, key = { it.key }) { p ->
                    PullRow(p, signals[p.key], selected = p.key == selected, onClick = { open(pullRoute(p)) })
                }
            }
        }
    }
}
