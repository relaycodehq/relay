package dev.relay.android.features.git

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.projectBranches
import dev.relay.android.remote.client.projectChangeBranch
import dev.relay.android.remote.model.BranchAction
import dev.relay.android.remote.model.BranchList
import dev.relay.android.remote.model.BranchRef
import dev.relay.android.ui.Button
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.TextField
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.GitBranch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.listPadding
import io.github.lyxnx.compose.ui.tablericons.outline.Plus

/** mobile/src/app/branches.tsx. [projectId] is what the bridge's branch calls take. */
class BranchesModel(private val remote: Remote, private val projectId: String) : ViewModel() {
    val list = MutableStateFlow<BranchList?>(null)
    val error = MutableStateFlow<String?>(null)
    val busy = MutableStateFlow(false)
    val asks = Asks()

    suspend fun load() {
        try {
            list.value = remote.call { projectBranches(projectId) }
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
        }
    }

    /** Switches to or creates [name]; [done] runs once it worked. */
    fun change(kind: String, name: String, done: () -> Unit = {}) {
        val now = list.value ?: return
        busy.value = true
        viewModelScope.launch {
            try {
                list.value = remote.call { projectChangeBranch(projectId, BranchAction(kind, name, now.current, now.head)) }
                done()
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                asks.alert(if (kind == "switch") "Couldn't switch" else "Couldn't create it", errorText(e))
                load()
            } finally {
                busy.value = false
            }
        }
    }
}

@Composable
fun BranchesScreen(remote: Remote, projectId: String) {
    val nav = LocalNavigator.current
    val model = viewModel(key = "branches:$projectId") { BranchesModel(remote, projectId) }
    val list by model.list.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    LaunchedEffect(live) { if (live) model.load() }
    var creating by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }

    Screen("Branches", onBack = nav.backAction, actions = {
        if (list != null) IconButton(TablerIcons.Outline.Plus, "New branch from here", { creating = true }, enabled = !busy)
    }) {
        val now = list
        when {
            now == null && error != null -> LoadFailed(error!!, model::load)
            now == null -> Loading()
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = listPadding()) {
                for ((title, rows) in listOf("Local" to now.branches.filter { !it.remote }, "Remote" to now.branches.filter { it.remote })) {
                    if (rows.isEmpty()) continue
                    item(key = title) {
                        SectionHeader(title, count = rows.size)
                        ListGroup {
                            for (b in rows) BranchRow(b, busy) {
                                model.asks.confirm(
                                    "Switch to ${b.name}?",
                                    "Uncommitted changes that would be overwritten stop the switch.",
                                    "Switch",
                                ) { model.change("switch", b.name) }
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating) {
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        Sheet({ creating = false }, title = "New branch from ${list?.current ?: "here"}") {
            TextField(
                name,
                { name = it },
                Modifier.fillMaxWidth(),
                placeholder = "feature/phone-remote",
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                focusRequester = focus,
            )
            Button(
                if (busy) "Creating…" else "Create and switch",
                {
                    model.change("create", name.trim()) {
                        creating = false
                        name = ""
                    }
                },
                Modifier.fillMaxWidth(),
                enabled = !busy && name.isNotBlank(),
            )
        }
    }
    AskHost(model.asks)
}

@Composable
private fun BranchRow(b: BranchRef, busy: Boolean, onSwitch: () -> Unit) {
    val c = RelayTheme.colors
    ListRow(
        b.name,
        subtitle = if (b.current) "Checked out" else if (b.worktree) "Checked out in a worktree" else null,
        leading = {
            if (b.current) Icon(TablerIcons.Outline.Check, null, tint = c.foreground, size = 16.dp)
            else Icon(TablerIcons.Outline.GitBranch, null, tint = c.mutedForeground, size = 16.dp)
        },
        onClick = if (b.current || b.worktree || busy) null else onSwitch,
    )
}
