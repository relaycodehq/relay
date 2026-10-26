package dev.relay.android.features.thread

// A finished run of tool calls grouped by what they did (logic/TraceTree.kt):
// rows and pairs always show, three or more of a kind fold behind a branch
// header into a tree hooked to it by elbow lines. A row opens to the code its
// calls wrote, or else to what they ran and printed.

import androidx.compose.foundation.background
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import dev.relay.android.features.images.looksAtImage
import dev.relay.android.features.thread.logic.BranchKind
import dev.relay.android.features.thread.logic.TracePiece
import dev.relay.android.features.thread.logic.TraceRow
import dev.relay.android.features.thread.logic.actionVerb
import dev.relay.android.features.thread.logic.rowFailed
import dev.relay.android.features.thread.logic.rowRunning
import dev.relay.android.features.thread.logic.traceTree
import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import io.github.lyxnx.compose.ui.tablericons.outline.Robot

/** A row's first line: the height every trace row keeps, so the thread doesn't jolt. */
private val LINE = 26.dp

/** Where a row's words start: past its 14dp icon and the 7dp gap. */
private val INDENT = 21.dp

/** Tools, and kinds of action this app doesn't know yet, keep their call's own row. */
internal fun drawsOwnRow(row: TraceRow) = actionVerb(row).isEmpty()

/** A run whose calls say what they did, told by what they did. */
@Composable
internal fun TraceTreeRun(calls: List<AgentActivity>) {
    val pieces = remember(calls) { traceTree(calls) }
    Column {
        for (piece in pieces) key(piece.id) {
            when (piece) {
                is TracePiece.Row -> ActionRow(piece.row)
                is TracePiece.Pair -> PairRow(piece.first, piece.second)
                is TracePiece.Branch -> Branch(piece)
            }
        }
    }
}

@Composable
private fun ActionRow(row: TraceRow, modifier: Modifier = Modifier) {
    if (drawsOwnRow(row)) {
        Column(modifier) { row.calls.forEach { ToolRow(it) } }
        return
    }
    val running = rowRunning(row)
    OpenableRow(row.calls, modifier, icon = { RowIcon(actionIcon(row.action.kind), running, rowFailed(row)) }, under = { LookedAt(row) }) {
        ActionLabel(row, live = running)
    }
}

@Composable
private fun PairRow(first: TraceRow, second: TraceRow) {
    OpenableRow(first.calls + second.calls, icon = { RowIcon(actionIcon(first.action.kind), running = false, failed = false) }) {
        PairLabel(first, second)
    }
}

/** The picture an image row looked at, under it as the call's own row showed it. */
@Composable
private fun LookedAt(row: TraceRow) {
    val call = row.calls.first()
    val shows = row.action.kind == "image" && LocalTrace.current.chatId.isNotEmpty() && looksAtImage(call)
    if (shows) Box(Modifier.padding(start = INDENT)) { Preview(call, LocalTrace.current.display(row.action.file.orEmpty())) }
}

@Composable
private fun RowIcon(icon: ImageVector, running: Boolean, failed: Boolean) {
    val c = RelayTheme.colors
    if (running) Spinner(size = 14.dp, color = c.mutedForeground)
    else Icon(icon, null, Modifier.alpha(0.75f), size = 14.dp, tint = if (failed) c.destructive else c.mutedForeground)
}

/** A row that opens to its calls when there's something inside them to show. */
@Composable
private fun OpenableRow(
    calls: List<AgentActivity>,
    modifier: Modifier = Modifier,
    icon: @Composable () -> Unit,
    under: @Composable () -> Unit = {},
    label: @Composable () -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val inside = calls.distinctBy { it.id }.filter(::opensTo)
    val press = if (inside.isEmpty()) Modifier else Modifier.pressable(onClick = { open = !open }, scale = false)
    Column(modifier) {
        Row(press.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            // The icon sits on the first line however many the words wrap onto.
            Box(Modifier.height(LINE), contentAlignment = Alignment.Center) { icon() }
            Box(Modifier.weight(1f).heightIn(min = LINE).padding(vertical = 3.dp), contentAlignment = Alignment.CenterStart) { label() }
        }
        under()
        if (open) inside.forEach { key(it.id) { CallInside(it) } }
    }
}

/** Whether a call has anything to show opened: code it wrote, output, or the command itself. */
private fun opensTo(a: AgentActivity) = a.wroteCode == true || a.detail != null || a.kind == "command"

/**
 * The code a call wrote, the command it ran, and what it printed: not when
 * that only confirms the code shown, but always when the call failed, to say why.
 */
@Composable
private fun CallInside(a: AgentActivity) {
    val wroteCode = a.wroteCode == true
    val showsOutput = a.detail != null && (!wroteCode || a.status == "failed")
    if (wroteCode) WrittenCodeOf(a, otherwise = { if (a.detail != null && !showsOutput) Detail(a) })
    if (a.kind == "command") CommandLine(a.label)
    if (showsOutput) Detail(a)
}

/** What ran, as typed: the row says what it did, this says how. */
@Composable
private fun CommandLine(command: String) {
    val c = RelayTheme.colors
    SelectionContainer(
        Modifier.padding(start = INDENT, top = 2.dp, bottom = 4.dp).fillMaxWidth()
            .background(c.muted, Radii.smShape).padding(horizontal = 9.dp, vertical = 6.dp),
    ) {
        Text(command, style = RelayTheme.type.monoSm, color = c.foreground, maxLines = 12)
    }
}

/** Three or more of a kind: a header that folds open into a tree of their rows. */
@Composable
private fun Branch(branch: TracePiece.Branch) {
    val c = RelayTheme.colors
    var open by rememberSaveable { mutableStateOf(false) }
    val running = branch.rows.any(::rowRunning)
    val failed = branch.kind == BranchKind.Check && branch.rows.any(::rowFailed)
    Column {
        Step(Modifier.pressable(onClick = { open = !open }, scale = false)) {
            RowIcon(branchIcon(branch), running, failed = false)
            Text(branch.heading, Modifier.weight(1f, fill = false), maxLines = 1, color = if (failed) c.destructive else c.mutedForeground)
            Icon(
                TablerIcons.Outline.ChevronRight, null, size = 13.dp, tint = c.faint,
                modifier = if (open) Modifier.rotate(90f) else Modifier,
            )
        }
        if (open) branch.rows.forEachIndexed { index, row ->
            val elbow = Modifier.treeElbow(last = index == branch.rows.lastIndex, color = c.faint.copy(alpha = 0.5f))
            key(row.id) { ActionRow(row, elbow.padding(start = INDENT)) }
        }
    }
}

private fun branchIcon(branch: TracePiece.Branch): ImageVector = when (branch.kind) {
    BranchKind.Read -> actionIcon("read")
    BranchKind.Search -> actionIcon("search")
    BranchKind.Web -> actionIcon("web")
    BranchKind.Edit -> actionIcon("edit")
    BranchKind.Run -> actionIcon("run")
    BranchKind.Check -> actionIcon("test")
    BranchKind.Commit -> actionIcon("commit")
    BranchKind.Tool -> if (allAgents(branch.rows)) TablerIcons.Outline.Robot else actionIcon("tool")
}

private fun allAgents(rows: List<TraceRow>) = rows.all { row -> row.calls.all { it.kind == "agent" } }

/**
 * The tree's line, drawn beside a row: down from the branch header's icon, and
 * a rounded └ into this row's first line. The last row's line stops at its elbow.
 */
private fun Modifier.treeElbow(last: Boolean, color: Color) = drawBehind {
    val x = 7.dp.toPx()
    val y = LINE.toPx() / 2
    val bend = 4.dp.toPx()
    val end = INDENT.toPx() - 4.dp.toPx()
    val width = 1.dp.toPx()
    if (!last) drawLine(color, Offset(x, 0f), Offset(x, size.height), width)
    val elbow = Path().apply {
        moveTo(x, 0f)
        lineTo(x, y - bend)
        quadraticTo(x, y, x + bend, y)
        lineTo(end, y)
    }
    drawPath(elbow, color, style = Stroke(width))
}
