package dev.relay.android.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.GitAction
import dev.relay.android.remote.model.RemoteDiffSource
import dev.relay.android.remote.model.WorkingChange
import dev.relay.android.remote.model.WorkingTree
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Divider
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Screen
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Text
import dev.relay.android.ui.TextField
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Minus
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import io.github.lyxnx.compose.ui.tablericons.outline.Sparkles

/** The desktop's Changes pane: commit and push everything in one go, or stage and commit a part. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChangesScreen(remote: Remote, where: String) {
    val nav = LocalNavigator.current
    val model = viewModel(key = "changes:$where") { ChangesModel(remote, where) }
    val state by model.state.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    LaunchedEffect(live) { if (live) model.load() }
    val tree = state.tree
    Screen(tree?.branch?.ifEmpty { null } ?: "Changes", onBack = nav.backAction) {
        when {
            tree == null && state.error != null -> LoadFailed(state.error!!, model::load)
            tree == null -> Loading()
            else -> Column(Modifier.fillMaxSize().imePadding()) {
                PullToRefreshBox(state.refreshing, model::refresh, Modifier.weight(1f).fillMaxWidth()) {
                    ChangesList(model, tree, state, onOpen = { change, area ->
                        nav.push(diffRoute(RemoteDiffSource.working(where, change.path, area)))
                    })
                }
                if (tree.changes.isNotEmpty()) CommitDock(model, tree, state)
            }
        }
    }
    AskHost(model.asks)
}

@Composable
private fun ChangesList(model: ChangesModel, tree: WorkingTree, state: ChangesState, onOpen: (WorkingChange, String) -> Unit) {
    val c = RelayTheme.colors
    val busy = state.busy != null
    val staged = tree.changes.filter { it.staged }
    val working = tree.changes.filter { it.unstaged }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
        if (tree.operation != null) item {
            Note("${operationInProgress(tree.operation)}. Finish it on your computer.", c.destructive)
        }
        if (tree.changes.isEmpty()) item { EmptyNote("No uncommitted changes.", Modifier.fillMaxWidth()) }
        for ((title, area, files) in listOf(Triple("Staged changes", "staged", staged), Triple("Working changes", "unstaged", working))) {
            if (files.isEmpty()) continue
            val isStaged = area == "staged"
            item(key = "head:$area") {
                SectionHeader(title, Modifier.padding(horizontal = 12.dp), action = {
                    Text(
                        if (isStaged) "Unstage all" else "Stage all",
                        Modifier.pressable({
                            val paths = files.map { it.path }
                            model.act(if (isStaged) "unstage" else "stage", if (isStaged) GitAction.unstage(tree.revision, paths) else GitAction.stage(tree.revision, paths))
                        }, enabled = !busy),
                        style = RelayTheme.type.caption,
                        color = if (busy) c.faint else c.foreground,
                    )
                })
            }
            items(files, key = { "$area:${it.path}" }) { f ->
                FileRow(f, isStaged, busy, onOpen = { onOpen(f, area) }) {
                    model.act(if (isStaged) "unstage" else "stage", if (isStaged) GitAction.unstage(tree.revision, listOf(f.path)) else GitAction.stage(tree.revision, listOf(f.path)))
                }
            }
        }
        item(key = "remote") { RemoteSection(model, tree, state) }
    }
}

@Composable
private fun FileRow(f: WorkingChange, staged: Boolean, busy: Boolean, onOpen: () -> Unit, onToggle: () -> Unit) {
    val c = RelayTheme.colors
    val code = if (staged) f.index else f.worktree
    val kind = changeKind(code, f.conflict)
    val slash = f.path.lastIndexOf('/')
    Row(Modifier.fillMaxWidth().heightIn(min = 46.dp).padding(end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f).pressable(onOpen, scale = false).padding(start = 16.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                if (f.conflict) "!" else if (code == "?") "U" else code,
                Modifier.width(14.dp),
                style = RelayTheme.type.monoSm,
                textAlign = TextAlign.Center,
                color = when (kind) {
                    ChangeKind.Added -> c.additionText
                    ChangeKind.Deleted, ChangeKind.Conflict -> c.deletionText
                    ChangeKind.Modified -> c.mutedForeground
                },
            )
            androidx.compose.material3.Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = c.foreground)) { append(f.path.substring(slash + 1)) }
                    if (slash > 0) withStyle(SpanStyle(color = c.faint)) { append("  " + f.path.substring(0, slash)) }
                },
                Modifier.weight(1f),
                style = RelayTheme.type.mono,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(
            if (staged) TablerIcons.Outline.Minus else TablerIcons.Outline.Plus,
            "${if (staged) "Unstage" else "Stage"} ${f.path}",
            onToggle,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = !busy,
        )
    }
}

@Composable
private fun RemoteSection(model: ChangesModel, tree: WorkingTree, state: ChangesState) {
    val c = RelayTheme.colors
    val busy = state.busy != null
    Column {
        SectionHeader("Remote", Modifier.padding(horizontal = 12.dp))
        Note(remoteLine(tree), c.mutedForeground)
        for (commit in tree.outgoing) {
            androidx.compose.material3.Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = c.faint, fontFamily = RelayTheme.type.mono.fontFamily)) { append(commit.sha.take(7) + " ") }
                    append(commit.subject)
                },
                Modifier.padding(horizontal = 16.dp, vertical = 3.dp),
                style = RelayTheme.type.sm.copy(color = c.foreground),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Row(Modifier.padding(horizontal = 16.dp).padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(if (state.busy == "fetch") "Fetching…" else "Fetch", { model.act("fetch", GitAction.fetch) }, variant = ButtonVariant.Outline, enabled = !busy)
            if (tree.behind > 0) Button(
                if (state.busy == "pull") "Pulling…" else "Pull",
                { model.act("pull", GitAction.pull(tree.revision)) },
                variant = ButtonVariant.Outline,
                enabled = !busy && tree.operation == null,
            )
            Button(
                if (state.busy == "push") "Pushing…" else "Push",
                {
                    val (title, message) = pushQuestion(tree)
                    model.asks.confirm(title, message, "Push") { model.act("push", GitAction.push(tree.revision)) }
                },
                variant = if (tree.changes.isEmpty()) ButtonVariant.Default else ButtonVariant.Outline,
                enabled = canPush(tree, busy),
            )
        }
    }
}

/** Pinned under the list, so the one-step commit is in reach however many files changed. */
@Composable
private fun CommitDock(model: ChangesModel, tree: WorkingTree, state: ChangesState) {
    val c = RelayTheme.colors
    val staged = tree.changes.filter { it.staged }
    val working = tree.changes.filter { it.unstaged }
    val allPaths = everyPath(tree)
    val stop = blocker(tree)
    val draft = state.draft
    // Committing while a message is on its way would go without it, unless you've typed your own.
    val ready = state.busy == null && stop == null && draft.text.isNotBlank() && !(state.writing && !draft.typed)
    val canShip = ready && allPaths.isNotEmpty() && allPaths.size <= MAX_COMMIT_FILES
    val canCommitStaged = ready && staged.isNotEmpty()
    // With some of it staged, the message describes that part.
    val partial = staged.isNotEmpty() && working.isNotEmpty()
    val writeFor = if (partial) staged.map { it.path } else allPaths
    val canWrite = !state.writing && state.busy == null && writeFor.isNotEmpty() && writeFor.size <= MAX_COMMIT_FILES
    val shipTo = tree.pushTarget
    Column(Modifier.fillMaxWidth().background(c.background)) {
        Divider()
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(commitHint(tree), Modifier.weight(1f), style = RelayTheme.type.xs, color = if (stop != null) c.destructive else c.mutedForeground, maxLines = 1)
                Button(
                    if (state.writing) "Writing…" else if (partial) "Write for staged" else "Write it for me",
                    { model.writeNow(writeFor) },
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = TablerIcons.Outline.Sparkles,
                    enabled = canWrite,
                )
            }
            TextField(
                draft.text,
                model::type,
                placeholder = if (state.writing && !draft.typed) "Writing a message…" else "Commit message",
                singleLine = false,
                minLines = 2,
                maxLines = 5,
                maxLength = MAX_COMMIT_MESSAGE,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (staged.isNotEmpty()) Button(
                    if (state.busy == "commit") "Committing…" else "Commit staged",
                    { model.commit(null, push = false) },
                    Modifier.weight(1f),
                    variant = ButtonVariant.Outline,
                    enabled = canCommitStaged,
                )
                Button(
                    when (state.busy) {
                        "ship" -> "Committing…"
                        "push" -> "Pushing…"
                        else -> if (shipTo != null) "Commit & push" else "Commit"
                    },
                    { model.commit(allPaths, push = shipTo != null) },
                    Modifier.weight(1f),
                    enabled = canShip,
                )
            }
        }
    }
}

@Composable
private fun Note(text: String, color: androidx.compose.ui.graphics.Color) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Text(text, color = color)
    }
}
