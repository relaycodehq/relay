package dev.relay.android.features.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.model.RemoteDiffSource
import dev.relay.android.remote.model.TurnFileChange
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowBackUp
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowForwardUp
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.listPadding

/**
 * The desktop's Turn changes pane: what one agent turn changed, or with
 * [worktree] everything the thread's worktree has that the branch it came
 * from doesn't yet (mobile/src/app/turn.tsx).
 *
 * [onAskAgent] sends the thread's agent a message when a merge conflicts, on
 * the thread's last settings (null before it has any), the way its composer
 * sends: through the outbox.
 */
@Composable
fun TurnScreen(
    remote: Remote,
    chatId: String,
    messageId: String?,
    worktree: Boolean,
    onAskAgent: suspend (text: String, settings: ResumeSettings?) -> Unit,
) {
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val model = viewModel(key = "turn:$chatId:$messageId:$worktree") { TurnModel(remote, chatId, messageId, worktree) }
    val thread by model.thread.collectAsStateWithLifecycle()
    val threadError by model.threadError.collectAsStateWithLifecycle()
    val status by model.status.collectAsStateWithLifecycle()
    val statusError by model.statusError.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    LaunchedEffect(live) { if (live) model.loadStatus() }
    val scope = rememberCoroutineScope()
    var merging by remember { mutableStateOf(false) }

    val turn = messageId?.let { id -> thread?.messages?.find { it.id == id } }
    val files: List<TurnFileChange>? = if (worktree) status?.files else turn?.changes
    val title = when {
        worktree -> status?.branch ?: "Worktree"
        turn != null -> "${agentName(turn.provider)} · ${SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(turn.ended ?: turn.created))}"
        else -> "Changes"
    }
    val reverted = files?.count { it.revertedBy != null } ?: 0
    val all = files?.size ?: 0

    Screen(title, onBack = nav.backAction) {
        val error = if (worktree) statusError else threadError
        when {
            files == null && error != null -> LoadFailed(error, { if (worktree) model.loadStatus() else model.reloadThread() })
            files == null -> Loading()
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = listPadding()) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(summary(worktree, status, all, reverted), Modifier.weight(1f), style = RelayTheme.type.xs, color = c.mutedForeground)
                        if (!worktree && all > 0) {
                            val redo = reverted == all
                            Button(
                                if (redo) "Redo all" else "Roll back all",
                                {
                                    if (redo) model.rewind(null, "redo")
                                    else model.asks.confirm(
                                        "Roll back ${all - reverted} files?",
                                        "They go back to how they were before this turn. Later edits are kept where they merge.",
                                        "Roll back",
                                        destructive = true,
                                    ) { model.rewind(null, "revert") }
                                },
                                variant = ButtonVariant.Ghost,
                                size = ButtonSize.Sm,
                                leadingIcon = if (redo) TablerIcons.Outline.ArrowForwardUp else TablerIcons.Outline.ArrowBackUp,
                                enabled = busy == null,
                            )
                        }
                    }
                    val s = status
                    if (worktree && s?.from != null && s.landed == null && !s.removed && s.files.isNotEmpty()) {
                        Button("Merge into ${s.from}", { merging = true }, Modifier.fillMaxWidth().padding(horizontal = 4.dp).padding(bottom = 8.dp))
                    }
                }
                if (files.isEmpty()) item { EmptyNote("Nothing changed.", Modifier.fillMaxWidth()) }
                for ((folder, group) in byFolder(files)) {
                    if (folder.isNotEmpty()) item(key = "dir:$folder") { SectionHeader(folder, count = group.size) }
                    items(group, key = { it.path }) { f ->
                        TurnFileRow(f, worktree, busy, onOpen = {
                            nav.push(diffRoute(if (worktree) RemoteDiffSource.worktree(chatId, f.path) else RemoteDiffSource.turn(chatId, messageId!!, f.path)))
                        }, onRewind = { model.rewind(listOf(f.path), if (f.revertedBy != null) "redo" else "revert") })
                    }
                }
            }
        }
    }
    val chat = thread
    if (merging && worktree && chat != null) MergeSheet(
        remote,
        workspaceId(chat.projectId, chatId),
        onDismiss = { merging = false },
        onMerged = { scope.launch { model.loadStatus() } },
        onAskAgent = { text ->
            onAskAgent(text, model.thread.value?.settings)
            nav.pop()
        },
    )
    AskHost(model.asks)
}

private fun summary(worktree: Boolean, status: dev.relay.android.remote.model.WorktreeStatus?, all: Int, reverted: Int): String {
    val count = plural(all, "file")
    if (!worktree) return "$count changed" + if (reverted > 0) " · $reverted rolled back" else ""
    val landed = status?.landed
    if (landed != null) return "Landed ${if (landed.by == "pr") "through its pull request" else "in"} ${status.from ?: "its branch"}."
    return "$count ${status?.from?.let { "ahead of $it" } ?: "changed"}"
}

@Composable
private fun TurnFileRow(f: TurnFileChange, worktree: Boolean, busy: String?, onOpen: () -> Unit, onRewind: () -> Unit) {
    val c = RelayTheme.colors
    val gone = f.revertedBy != null
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (pressed) c.hover else Color.Transparent)
            .heightIn(min = 44.dp).padding(end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).pressable(onOpen, scale = false, interaction = press).padding(start = 12.dp, top = 9.dp, bottom = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                f.path.substringAfterLast('/'),
                Modifier.weight(1f),
                style = RelayTheme.type.mono.copy(textDecoration = if (gone) TextDecoration.LineThrough else null),
                color = if (gone) c.mutedForeground else c.foreground,
                maxLines = 1,
            )
            if (f.binary == true) Text("binary", style = RelayTheme.type.monoSm, color = c.mutedForeground)
            else {
                Text("+${f.additions}", style = RelayTheme.type.monoSm, color = c.additionText)
                Text("−${f.deletions}", style = RelayTheme.type.monoSm, color = c.deletionText)
            }
        }
        if (!worktree) Box(Modifier.padding(start = 8.dp)) {
            IconButton(
                if (gone) TablerIcons.Outline.ArrowForwardUp else TablerIcons.Outline.ArrowBackUp,
                if (gone) "Redo ${f.path}" else "Roll back ${f.path}",
                onRewind,
                size = ButtonSize.Sm,
                tint = c.mutedForeground,
                enabled = busy == null,
                loading = busy == f.path,
            )
        }
    }
}
