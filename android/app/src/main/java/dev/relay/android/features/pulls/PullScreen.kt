package dev.relay.android.features.pulls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.features.git.AskHost
import dev.relay.android.features.git.LoadFailed
import dev.relay.android.features.git.Loading
import dev.relay.android.features.git.rememberLive
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.PullRef
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Divider
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.TextField
import dev.relay.android.ui.ribbon.RibbonRefreshBox
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.ExternalLink
import io.github.lyxnx.compose.ui.tablericons.outline.MessagePlus
import kotlinx.coroutines.launch

/** Wide enough for the PR beside what it waits on: an unfolded Fold with the sidebar hidden. */
private val TWO_COLUMNS = 680.dp

private enum class Writing { Comment, Changes, Ask }

/**
 * One pull request: what it is, what it waits on (checks, reviews, conflicts) with the merge
 * button, the agent buttons that act on that, then its description, files and conversation. A wide pane splits it in two:
 * the reading on the left, the state and actions on the right.
 */
@Composable
fun PullScreen(remote: Remote, route: Route.Pull) {
    val nav = LocalNavigator.current
    val uri = LocalUriHandler.current
    val filesDir = LocalContext.current.filesDir
    val ref = PullRef(route.owner, route.name, route.number, route.server)
    val model = viewModel(key = "pull:${pullKey(ref)}") { PullModel(remote, ref) }
    val page by model.page.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val overview by remote.overview.collectAsState()
    val live = rememberLive(remote)
    var writing by rememberSaveable { mutableStateOf<Writing?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(live) { if (live) model.load() }

    Screen(
        "${route.name} #${route.number}",
        onBack = nav.backAction,
        actions = {
            page?.let { p -> IconButton(TablerIcons.Outline.ExternalLink, "Open on the host", { uri.openUri(p.pull.html_url) }, tint = RelayTheme.colors.mutedForeground) }
        },
    ) {
        val p = page
        when {
            p == null && error != null -> return@Screen LoadFailed(error!!, { model.load() })
            p == null -> return@Screen Loading()
        }
        p!!
        val project = projectFor(overview, ref.name)
        val threads = overview?.chats.orEmpty().filter { it.branch == p.pull.head.ref && (project == null || it.projectId == project.id) }
        val start = { prompt: String ->
            model.agent {
                val id = startPullThread(remote, filesDir, project!!.id, p.pull.head.ref, prompt)
                nav.openInPane(Route.Thread(id))
            }
        }
        val reading: LazyListScope.() -> Unit = {
            item("description") { DescriptionCard(p.pull.body) }
            item("files") { FilesCard(p.files, p.moreFiles, p.pull.changed_files) { uri.openUri("${p.pull.html_url}/files") } }
            item("conversation") { DiscussionCard(p.comments) }
        }
        val state: LazyListScope.() -> Unit = {
            item("merge") {
                MergeCard(p, busy == "merge") { method ->
                    // The head on screen now: a reload while this is open mustn't merge one nobody saw.
                    val head = p.pull.head.sha
                    model.asks.confirm("${methodLabel(method)} #${p.pull.number}?", "${p.pull.head.ref} into ${p.pull.base.ref}", "Merge") { model.merge(head, method) }
                }
            }
            item("agent") {
                AgentCard(p, project?.name, busy == "agent", onFixCi = { start(fixCiPrompt(p)) }, onAddress = { start(addressReviewPrompt(p)) }, onAsk = { writing = Writing.Ask })
            }
            item("threads") { BranchThreadsCard(threads) { nav.openInPane(Route.Thread(it.id)) } }
        }
        val pad = PaddingValues(16.dp)
        val gap = Arrangement.spacedBy(12.dp)
        RibbonRefreshBox(refreshing, {
            refreshing = true
            scope.launch {
                try {
                    model.load()
                } finally {
                    refreshing = false
                }
            }
        }, Modifier.weight(1f).fillMaxWidth()) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                if (maxWidth >= TWO_COLUMNS) Row(Modifier.fillMaxSize()) {
                    LazyColumn(Modifier.weight(1.4f).fillMaxSize(), contentPadding = pad, verticalArrangement = gap) {
                        item("header") { PullHeader(p.pull) }
                        reading()
                    }
                    Divider(vertical = true)
                    LazyColumn(Modifier.weight(1f).fillMaxSize(), contentPadding = pad, verticalArrangement = gap) { state() }
                } else LazyColumn(Modifier.fillMaxSize(), contentPadding = pad, verticalArrangement = gap) {
                    item("header") { PullHeader(p.pull) }
                    state()
                    reading()
                }
            }
        }
        if (p.pull.state == "open" && !p.pull.merged) ReviewBar(
            busy,
            onComment = { writing = Writing.Comment },
            onChanges = { writing = Writing.Changes },
            onApprove = {
                model.asks.confirm("Approve #${p.pull.number}?", p.pull.title, "Approve") { model.review("APPROVED", "") }
            },
        )
    }
    writing?.let { w ->
        WriteSheet(w, onDismiss = { writing = null }) { text ->
            writing = null
            when (w) {
                Writing.Comment -> model.comment(text)
                Writing.Changes -> model.review("REQUEST_CHANGES", text)
                Writing.Ask -> page?.let { p ->
                    val project = projectFor(overview, ref.name) ?: return@let
                    model.agent {
                        val id = startPullThread(remote, filesDir, project.id, p.pull.head.ref, askPrompt(p, text))
                        nav.openInPane(Route.Thread(id))
                    }
                }
            }
        }
    }
    AskHost(model.asks)
}

/** Comment, request changes or approve, pinned under the PR where a thumb reaches them. */
@Composable
private fun ReviewBar(busy: String?, onComment: () -> Unit, onChanges: () -> Unit, onApprove: () -> Unit) {
    val c = RelayTheme.colors
    Column(Modifier.fillMaxWidth().background(c.background)) {
        Divider()
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button("Comment", onComment, Modifier.weight(1f), variant = ButtonVariant.Outline, leadingIcon = TablerIcons.Outline.MessagePlus, enabled = busy == null, loading = busy == "comment")
            Button("Changes", onChanges, Modifier.weight(1f), variant = ButtonVariant.Outline, enabled = busy == null, loading = busy == "changes")
            Button("Approve", onApprove, Modifier.weight(1f), leadingIcon = TablerIcons.Outline.Check, enabled = busy == null, loading = busy == "approve")
        }
    }
}

@Composable
private fun WriteSheet(writing: Writing, onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val (title, action, hint) = when (writing) {
        Writing.Comment -> Triple("Comment", "Comment", "Say something on the PR")
        Writing.Changes -> Triple("Request changes", "Request changes", "What needs to change")
        Writing.Ask -> Triple("Ask an agent", "Start thread", "What do you want to know or done?")
    }
    Sheet(onDismiss, title = title, description = if (writing == Writing.Ask) "A new thread on the PR's branch gets this with the PR's details." else null) {
        TextField(text, { text = it }, Modifier.fillMaxWidth(), placeholder = hint, singleLine = false, minLines = 4)
        Button(action, { onSend(text.trim()) }, Modifier.fillMaxWidth(), enabled = text.isNotBlank())
    }
}
