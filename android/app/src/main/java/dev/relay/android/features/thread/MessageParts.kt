package dev.relay.android.features.thread

// The rows around and under a message (mobile/src/ui/MessageView.tsx): status
// lines across the thread, handoffs, worktree setup, changed files and the
// answer's actions.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text as MaterialText
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.readaloud.ReadAloudButton
import dev.relay.android.features.thread.logic.Clock
import dev.relay.android.features.thread.logic.agentError
import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.features.thread.logic.answerSpeed
import dev.relay.android.features.thread.logic.compactedTokens
import dev.relay.android.features.thread.logic.copiedNote
import dev.relay.android.features.thread.logic.formatCost
import dev.relay.android.features.thread.logic.formatTokens
import dev.relay.android.features.thread.logic.streamedOutput
import dev.relay.android.features.thread.logic.worktreeCommandNote
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.TurnFileChange
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowBackUp
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowForwardUp
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowsSplit
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.Copy
import io.github.lyxnx.compose.ui.tablericons.outline.Dots
import io.github.lyxnx.compose.ui.tablericons.outline.CornerUpLeft
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Rolls a turn's files back or forward; answers the files later edits overlap, which stop it. */
typealias Rewind = suspend (paths: List<String>?, mode: String, force: Boolean) -> List<String>

/** A line across the thread with a note in the middle, for compactions and handoffs. */
@Composable
fun StatusRow(text: String, failed: Boolean = false, action: Pair<String, () -> Unit>? = null) {
    val c = RelayTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.weight(1f).height(RelayTheme.hairline).background(c.border))
        Text(text, Modifier.weight(1f, fill = false), style = RelayTheme.type.xs, color = if (failed) c.destructive else c.mutedForeground, textAlign = TextAlign.Center)
        action?.let { (label, onPress) ->
            Text(label, Modifier.pressable(onClick = onPress, scale = false), style = RelayTheme.type.xs, color = c.accent)
        }
        Box(Modifier.weight(1f).height(RelayTheme.hairline).background(c.border))
    }
}

@Composable
private fun NoteBox(content: @Composable () -> Unit) {
    val c = RelayTheme.colors
    Box(
        Modifier.padding(start = 40.dp, end = 40.dp, bottom = 8.dp).fillMaxWidth()
            .drawBehind { drawLine(c.border, Offset(1.dp.toPx(), 0f), Offset(1.dp.toPx(), size.height), 2.dp.toPx()) }
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) { content() }
}

@Composable
fun HandoffRow(m: ChatMessage) {
    val handoff = m.handoff ?: return
    var open by rememberSaveable(m.id) { mutableStateOf(false) }
    val from = agentName(handoff.from)
    val switched = if (handoff.computer != null) "Continued on ${handoff.computer} · ${Clock().clock(m.created)}"
    else "Switched from $from to ${agentName(handoff.to)}${if (handoff.byRelay == true) " · $from couldn't write a note, Relay did" else ""}"
    val note = m.body.trim().takeIf { m.status == "complete" && it.isNotEmpty() }
    Column {
        StatusRow(
            when {
                m.status == "streaming" -> "$from is writing a handoff note for ${handoff.computer ?: agentName(handoff.to)}…"
                note != null -> switched
                else -> "$switched · no handoff note"
            },
            action = note?.let { (if (open) "Hide note" else "Show note") to { open = !open } },
        )
        if (open && note != null) NoteBox { Markdown(note, small = true) }
    }
}

/** The desktop's CompactionRow: where a session was compacted, and the summary the agent kept from it. */
@Composable
fun CompactionRow(m: ChatMessage) {
    var open by rememberSaveable(m.id) { mutableStateOf(false) }
    val summary = m.compactSummary?.takeIf { m.status == "complete" && it.isNotBlank() }
    Column {
        StatusRow(
            when {
                m.status == "streaming" -> "Compacting context…"
                m.status == "complete" ->
                    "Context compacted ${compactedTokens(m.compactedFrom, m.context?.usedTokens?.toDouble())}".trim()
                m.status == "cancelled" -> "Compaction stopped"
                m.error != null && m.signIn == null -> agentError(m.error).message
                else -> "Compaction failed"
            },
            failed = m.status == "failed",
            action = summary?.let { (if (open) "Hide summary" else "Show summary") to { open = !open } },
        )
        if (open && summary != null) NoteBox {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${agentName(m.provider)} kept this after compacting", style = RelayTheme.type.xs, color = RelayTheme.colors.mutedForeground)
                Markdown(summary, small = true)
            }
        }
        m.signIn?.let { SignInNote(it) }
    }
}

/** The desktop's WorktreeCommandRow: what the project's setup or teardown printed, and running setup again. */
@Composable
fun WorktreeCommandRow(m: ChatMessage, onRerun: (() -> Unit)?) {
    val run = m.worktreeCommand ?: return
    var open by rememberSaveable(m.id) { mutableStateOf(false) }
    val text = listOfNotNull(run.copied?.takeIf { it.isNotEmpty() }?.let(::copiedNote), run.output.takeIf { it.isNotEmpty() })
        .joinToString("\n\n")
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        StatusRow(
            worktreeCommandNote(run, m.status),
            failed = m.status == "failed" || m.status == "cancelled",
            action = text.takeIf { it.isNotEmpty() }?.let { (if (open) "Hide output" else "Show output") to { open = !open } },
        )
        if (onRerun != null) Text(
            "Run setup again",
            Modifier.padding(bottom = 8.dp).pressable(onClick = onRerun, scale = false),
            style = RelayTheme.type.xs,
            color = RelayTheme.colors.accent,
        )
        if (open && text.isNotEmpty()) NoteBox {
            SelectionContainer {
                Text("$ ${run.command}\n${text.takeLast(4000)}", style = RelayTheme.type.monoSm, color = RelayTheme.colors.mutedForeground)
            }
        }
    }
}

@Composable
fun ChangedFiles(
    files: List<TurnFileChange>,
    onOpen: (TurnFileChange) -> Unit,
    onOpenAll: (() -> Unit)?,
    onRewind: Rewind?,
    failures: FailureState,
) {
    val c = RelayTheme.colors
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var overlap by remember { mutableStateOf<Pair<String, List<String>>?>(null) }
    val add = files.sumOf { it.additions }
    val del = files.sumOf { it.deletions }
    val reverted = files.count { it.revertedBy != null }
    val redo = reverted == files.size
    // The desktop's ChangedFilesCard: confirm a rollback of several files, and
    // offer to overwrite when later edits overlap it.
    fun rewind(mode: String, force: Boolean = false) {
        val job = onRewind ?: return
        working = true
        scope.launch {
            try {
                val conflicts = job(null, mode, force)
                if (conflicts.isNotEmpty()) overlap = mode to conflicts
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failures.show("Couldn't roll back", e.message ?: e.toString())
            } finally {
                working = false
            }
        }
    }
    Column(Modifier.fillMaxWidth().border(RelayTheme.hairline, c.border, Radii.mdShape).background(c.card, Radii.mdShape)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (files.size == 1) "1 file changed" else "${files.size} files changed",
                Modifier.weight(1f).then(if (onOpenAll != null) Modifier.pressable(onClick = onOpenAll, scale = false) else Modifier),
                style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold),
            )
            Counts(add, del)
            if (onRewind != null) Row(
                Modifier.padding(start = 12.dp).alpha(if (working) 0.5f else 1f).pressable(
                    onClick = {
                        when {
                            redo -> rewind("redo")
                            files.size - reverted > 1 -> confirm = true
                            else -> rewind("revert")
                        }
                    },
                    enabled = !working,
                    scale = false,
                ),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon(if (redo) TablerIcons.Outline.ArrowForwardUp else TablerIcons.Outline.ArrowBackUp, null, size = 14.dp, tint = c.mutedForeground)
                Text(if (redo) "Redo" else "Roll back", style = RelayTheme.type.monoSm, color = c.mutedForeground)
            }
        }
        Box(Modifier.fillMaxWidth().height(RelayTheme.hairline).background(c.border))
        for (f in files) {
            val slash = f.path.lastIndexOf('/')
            Row(
                Modifier.fillMaxWidth().heightIn(min = 40.dp).pressable(onClick = { onOpen(f) }, scale = false).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MaterialText(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = c.foreground, textDecoration = if (f.revertedBy != null) TextDecoration.LineThrough else null)) {
                            append(f.path.substring(slash + 1))
                        }
                        if (slash > 0) withStyle(SpanStyle(color = c.faint)) { append("  ${f.path.substring(0, slash)}") }
                    },
                    Modifier.weight(1f),
                    style = RelayTheme.type.monoSm,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (f.binary == true) Text("binary", style = RelayTheme.type.monoSm, color = c.mutedForeground) else Counts(f.additions, f.deletions)
            }
        }
    }
    if (confirm) ConfirmDialog(
        title = "Roll back ${files.size - reverted} files?",
        message = "They go back to how they were before this turn. Later edits are kept where they merge.",
        confirmText = "Roll back",
        destructive = true,
        onConfirm = { confirm = false; rewind("revert") },
        onDismiss = { confirm = false },
    )
    overlap?.let { (mode, conflicts) ->
        val who = if (conflicts.size == 1) "${conflicts[0].substringAfterLast('/')} was" else "${conflicts.size} files were"
        ConfirmDialog(
            title = "Nothing was changed",
            message = "$who edited after ${if (mode == "revert") "this turn" else "the rollback"} in ways that overlap it.",
            confirmText = "Overwrite anyway",
            destructive = true,
            onConfirm = { overlap = null; rewind(mode, force = true) },
            onDismiss = { overlap = null },
        )
    }
}

@Composable
private fun Counts(add: Int, del: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("+$add", style = RelayTheme.type.monoSm, color = RelayTheme.colors.additionText)
        Text("−$del", style = RelayTheme.type.monoSm, color = RelayTheme.colors.deletionText)
    }
}

/** The desktop's MessageActions: when it was sent, how fast it wrote, what it cost, copy, fork, reply. */
@Composable
fun MessageActions(message: ChatMessage, onReply: (() -> Unit)?, onFork: (() -> Unit)?, onMore: (() -> Unit)? = null) {
    val c = RelayTheme.colors
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1500)
            copied = false
        }
    }
    val speed = answerSpeed(message.streamed)
    val output = streamedOutput(message.streamed)
    val written = if (output != null && speed != null) "${formatTokens(output)} out · $speed tok/s" else null
    val cost = message.cost?.takeIf { it > 0 }?.let(::formatCost)
    val now = rememberNow(60_000)
    Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        Text(Clock().sentLabel(message.ended ?: message.created, now), style = RelayTheme.type.xs, color = c.faint)
        if (written != null || cost != null)
            Text(listOfNotNull(written, cost).joinToString(" · "), style = RelayTheme.type.xs, color = c.faint)
        Icon(
            if (copied) TablerIcons.Outline.Check else TablerIcons.Outline.Copy,
            if (copied) "Copied" else "Copy answer",
            Modifier.pressable(onClick = {
                copyText(context, message.body)
                copied = true
            }),
            tint = c.mutedForeground,
        )
        val remote = LocalThreadRemote.current
        if (remote != null && message.status == "complete" && message.body.isNotBlank())
            ReadAloudButton(remote, message.id, message.body)
        if (onFork != null) Icon(TablerIcons.Outline.ArrowsSplit, "Fork into a new thread", Modifier.pressable(onClick = onFork), tint = c.mutedForeground)
        if (onReply != null) Icon(TablerIcons.Outline.CornerUpLeft, "Reply to message", Modifier.pressable(onClick = onReply), tint = c.mutedForeground)
        if (onMore != null) Icon(TablerIcons.Outline.Dots, "More for this answer", Modifier.pressable(onClick = onMore), tint = c.mutedForeground)
    }
}
