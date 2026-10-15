package dev.relay.android.features.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.projectCommit
import dev.relay.android.remote.client.projectHistory
import dev.relay.android.remote.model.CommitDetail
import dev.relay.android.remote.model.CommitFileChange
import dev.relay.android.remote.model.CommitLog
import dev.relay.android.remote.model.CommitSummary
import dev.relay.android.remote.model.RemoteDiffSource
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import dev.relay.android.ui.listPadding
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.GitCommit

private const val PAGE = 100

class HistoryModel(private val remote: Remote, private val where: String) : ViewModel() {
    val log = MutableStateFlow<CommitLog?>(null)
    val error = MutableStateFlow<String?>(null)
    val limit = MutableStateFlow(PAGE)

    suspend fun load() {
        try {
            log.value = remote.call { projectHistory(where, "head", limit.value) }
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
        }
    }
}

/** The checked-out branch's commits, newest first (mobile/src/app/history.tsx). */
@Composable
fun HistoryScreen(remote: Remote, where: String) {
    val nav = LocalNavigator.current
    val model = viewModel(key = "history:$where") { HistoryModel(remote, where) }
    val log by model.log.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val limit by model.limit.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    LaunchedEffect(live, limit) { if (live) model.load() }
    Screen("History", onBack = nav.backAction) {
        val now = log
        when {
            now == null && error != null -> LoadFailed(error!!, model::load)
            now == null -> Loading()
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = listPadding(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(now.commits, key = { it.sha }) { c ->
                    ListRow(
                        c.subject,
                        subtitle = historyLine(c),
                        subtitleLines = 1,
                        leadingIcon = TablerIcons.Outline.GitCommit,
                        chevron = true,
                        onClick = { nav.push(Route.Commit(where, c.sha)) },
                    )
                }
                if (now.more) item {
                    Button("Older commits", { model.limit.value += PAGE }, Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 12.dp), variant = ButtonVariant.Outline)
                }
            }
        }
    }
}

/**
 * "abc1234 · Ada · 5m ago · main, origin/main". The Expo app joined the ref
 * objects themselves and printed "[object Object]"; this shows their names.
 */
fun historyLine(c: CommitSummary, now: Long = System.currentTimeMillis()): String {
    val refs = if (c.refs.isEmpty()) "" else " · " + c.refs.joinToString(", ") { it.name }
    return "${c.sha.take(7)} · ${c.author} · ${ago(c.time * 1000, now)}$refs"
}

private val statusLabels = mapOf("A" to "Added", "M" to "Modified", "D" to "Deleted", "R" to "Renamed", "C" to "Copied", "T" to "Type changed")

/** The file's folder, then what [commitFileLine] says. */
private fun fileLine(f: CommitFileChange): String =
    listOfNotNull(f.path.substringBeforeLast('/', "").ifEmpty { null }, commitFileLine(f)).joinToString(" · ")

fun commitFileLine(f: CommitFileChange): String {
    val label = statusLabels[f.status] ?: f.status
    if (f.binary) return "$label · binary"
    return "$label · +${f.additions} −${f.deletions}" + (f.previousPath?.let { " · from $it" } ?: "")
}

class CommitModel(private val remote: Remote, private val where: String, private val sha: String) : ViewModel() {
    val commit = MutableStateFlow<CommitDetail?>(null)
    val error = MutableStateFlow<String?>(null)

    suspend fun load() {
        try {
            commit.value = remote.call { projectCommit(where, sha) }
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
        }
    }
}

/** One commit: its message, and the files it changed against its first parent (mobile/src/app/commit.tsx). */
@Composable
fun CommitScreen(remote: Remote, where: String, sha: String) {
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val model = viewModel(key = "commit:$where:$sha") { CommitModel(remote, where, sha) }
    val commit by model.commit.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    LaunchedEffect(live) { if (live && model.commit.value == null) model.load() }
    Screen(sha.take(7), onBack = nav.backAction) {
        val now = commit
        when {
            now == null && error != null -> LoadFailed(error!!, model::load)
            now == null -> Loading()
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = listPadding(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                item {
                    SelectionContainer {
                        Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(now.subject, style = RelayTheme.type.title.copy(fontWeight = FontWeight.SemiBold))
                            if (now.body.isNotBlank()) Text(now.body.trim())
                            Text("${now.author} · ${dateTime(now.time * 1000)}", style = RelayTheme.type.xs, color = c.mutedForeground)
                            Text(now.sha, style = RelayTheme.type.monoSm, color = c.faint)
                        }
                    }
                }
                item { SectionHeader("Files", count = now.files.size) }
                items(now.files, key = { it.path }) { f ->
                    ListRow(f.path.substringAfterLast('/'), subtitle = fileLine(f), subtitleLines = 1, chevron = true, onClick = {
                        nav.push(diffRoute(RemoteDiffSource.commit(where, sha, f.path)))
                    })
                }
            }
        }
    }
}
