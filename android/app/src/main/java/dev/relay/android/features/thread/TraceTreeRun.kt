package dev.relay.android.features.thread

// A finished run of tool calls grouped by what they did (logic/TraceTree.kt):
// rows and pairs always show, three or more of a kind fold behind a branch
// header into a tree hooked to it by elbow lines, and a long run folds into
// one line the same way. A row opens to the code its calls wrote or read, or
// else to what they ran and printed.

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
import dev.relay.android.features.thread.logic.branchOf
import dev.relay.android.features.thread.logic.readCode
import dev.relay.android.features.thread.logic.readCodeWhenWhole
import dev.relay.android.features.thread.logic.allFailed
import dev.relay.android.features.thread.logic.rowFailed
import dev.relay.android.features.thread.logic.showsOutput
import dev.relay.android.features.thread.logic.rowRunning
import dev.relay.android.features.thread.logic.traceRun
import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.CallAction
import dev.relay.android.ui.Icon
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

/**
 * A run the agent has moved on from, told by what its calls did: one line
 * when its tree is long, opening to that tree. The turn's only run shows its
 * tree as it is, since the turn's heading already says what it did.
 */
@Composable
internal fun ClosedRun(calls: List<AgentActivity>, only: Boolean) {
    val run = remember(calls) { traceRun(calls) }
    val summary = run.summary
    if (summary == null || only) return Column { for (piece in run.pieces) key(piece.id) { Piece(piece) } }
    var open by rememberSaveable { mutableStateOf(false) }
    val unfold = LocalUnfold.current
    val first = run.pieces.first()
    val failed = allFailed(run.pieces.flatMap(::rowsIn))
    Column {
        FoldHeading(branchIcon(firstKind(first), rowsIn(first)), summary, failed, open, onToggle = { unfold { open = !open } })
        if (open) run.pieces.forEachIndexed { index, piece ->
            val elbow = Modifier.treeElbow(last = index == run.pieces.lastIndex, color = treeLine())
            key(piece.id) { Piece(piece, elbow.padding(start = INDENT)) }
        }
    }
}

@Composable
private fun Piece(piece: TracePiece, modifier: Modifier = Modifier) = when (piece) {
    is TracePiece.Row -> ActionRow(piece.row, modifier)
    is TracePiece.Pair -> PairRow(piece.first, piece.second, modifier)
    is TracePiece.Branch -> Branch(piece, modifier)
}

private fun rowsIn(piece: TracePiece): List<TraceRow> = when (piece) {
    is TracePiece.Row -> listOf(piece.row)
    is TracePiece.Pair -> listOf(piece.first, piece.second)
    is TracePiece.Branch -> piece.rows
}

/** What kind the run started with, for its folded line's icon. */
private fun firstKind(piece: TracePiece): BranchKind = when (piece) {
    is TracePiece.Branch -> piece.kind
    is TracePiece.Row -> branchOf(piece.row.action)
    is TracePiece.Pair -> branchOf(piece.first.action)
}

/** One thing done; while its call runs it keeps its icon and its verb shines. */
@Composable
internal fun ActionRow(row: TraceRow, modifier: Modifier = Modifier) {
    if (drawsOwnRow(row)) {
        Column(modifier) { row.calls.forEach { ToolRow(it) } }
        return
    }
    OpenableRow(listOf(row), modifier, icon = { RowIcon(actionIcon(row.action.kind), rowFailed(row)) }, under = { LookedAt(row) }) {
        ActionLabel(row, live = rowRunning(row))
    }
}

@Composable
private fun PairRow(first: TraceRow, second: TraceRow, modifier: Modifier = Modifier) {
    OpenableRow(listOf(first, second), modifier, icon = { RowIcon(actionIcon(first.action.kind), failed = false) }) {
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
private fun RowIcon(icon: ImageVector, failed: Boolean) {
    val c = RelayTheme.colors
    Icon(icon, null, Modifier.alpha(0.75f), size = 14.dp, tint = if (failed) c.destructive else c.mutedForeground)
}

/** A row that opens to its calls when there's something inside them to show. */
@Composable
private fun OpenableRow(
    rows: List<TraceRow>,
    modifier: Modifier = Modifier,
    icon: @Composable () -> Unit,
    under: @Composable () -> Unit = {},
    label: @Composable () -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val unfold = LocalUnfold.current
    val inside = rows.flatMap { it.calls }.distinctBy { it.id }.filter(::opensTo)
    val press = if (inside.isEmpty()) Modifier else Modifier.pressable(onClick = { unfold { open = !open } }, scale = false)
    Column(modifier) {
        Row(press.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.height(LINE), contentAlignment = Alignment.Center) { icon() }
            Box(Modifier.weight(1f).heightIn(min = LINE).padding(vertical = 3.dp), contentAlignment = Alignment.CenterStart) { label() }
        }
        under()
        if (open) inside.forEach { key(it.id) { CallInside(it, rows) } }
    }
}

/** Whether a call has anything to show opened: code it wrote, output, or the command itself. */
private fun opensTo(a: AgentActivity) = a.wroteCode == true || a.detail != null || a.kind == "command"

/**
 * The code a call wrote for these rows, the command it ran, and what it
 * printed: not when that only confirms the code shown, but always for a
 * command, whose script printed it, and when the call failed, to say why.
 * A call that did several things prints under the row of the first only.
 * A read of one file opens as that file's lines instead.
 */
@Composable
private fun CallInside(a: AgentActivity, rows: List<TraceRow>) {
    if (readCode(a) != null) return ReadInside(a)
    val wroteCode = a.wroteCode == true
    val printedHere = rows.any { a in it.calls && showsOutput(it, a) }
    val showsOutput = printedHere && a.detail != null && (!wroteCode || a.kind == "command" || a.status == "failed")
    if (wroteCode) WrittenCodeOf(a, shows = { writtenFor(rows, a, it) }, otherwise = { if (printedHere && a.detail != null && !showsOutput) Detail(a) })
    if (a.kind == "command") CommandLine(a.label)
    if (showsOutput) Detail(a)
}

/**
 * Whether a file a call wrote belongs under these rows: a call that wrote
 * three files has a row for each. A file none of the call's actions names,
 * its opener cut off the label, goes with whichever row opens.
 */
private fun writtenFor(rows: List<TraceRow>, call: AgentActivity, path: String): Boolean {
    val about = rows.mapNotNull { writtenFile(it.action) }.toSet()
    val named = call.actions.orEmpty().mapNotNull(::writtenFile).toSet()
    return path in about || path !in named
}

private fun writtenFile(action: CallAction) = if (action.kind in setOf("edit", "create", "delete")) action.file else null

/** A read of one file: its lines once the whole output is here, and plain as before until then. */
@Composable
private fun ReadInside(a: AgentActivity) {
    val fetched = fetchedDetail(a)
    val read = remember(a, fetched) { readCodeWhenWhole(a, fetched) }
    if (read != null) return ReadFile(read)
    if (a.kind == "command") CommandLine(a.label)
    Detail(a, fetched ?: a.detail.orEmpty())
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
private fun Branch(branch: TracePiece.Branch, modifier: Modifier = Modifier) {
    var open by rememberSaveable { mutableStateOf(false) }
    val unfold = LocalUnfold.current
    val failed = allFailed(branch.rows)
    Column(modifier) {
        FoldHeading(branchIcon(branch.kind, branch.rows), branch.heading, failed, open, onToggle = { unfold { open = !open } })
        if (open) branch.rows.forEachIndexed { index, row ->
            val elbow = Modifier.treeElbow(last = index == branch.rows.lastIndex, color = treeLine())
            key(row.id) { ActionRow(row, elbow.padding(start = INDENT)) }
        }
    }
}

/** A branch's or a folded run's line; red only when every row under it failed. */
@Composable
private fun FoldHeading(icon: ImageVector, text: String, failed: Boolean, open: Boolean, onToggle: () -> Unit) {
    val c = RelayTheme.colors
    Step(Modifier.pressable(onClick = onToggle, scale = false)) {
        RowIcon(icon, failed = false)
        Text(text, Modifier.weight(1f, fill = false), maxLines = 1, color = if (failed) c.destructive else c.mutedForeground)
        Icon(
            TablerIcons.Outline.ChevronRight, null, size = 13.dp, tint = c.faint,
            modifier = if (open) Modifier.rotate(90f) else Modifier,
        )
    }
}

private fun branchIcon(kind: BranchKind, rows: List<TraceRow>): ImageVector = when (kind) {
    BranchKind.Read -> actionIcon("read")
    BranchKind.Search -> actionIcon("search")
    BranchKind.Web -> actionIcon("web")
    BranchKind.Edit -> actionIcon("edit")
    BranchKind.Run -> actionIcon("run")
    BranchKind.Git -> actionIcon("git")
    BranchKind.Check -> actionIcon("test")
    BranchKind.Commit -> actionIcon("commit")
    BranchKind.Tool -> if (allAgents(rows)) TablerIcons.Outline.Robot else actionIcon("tool")
}

private fun allAgents(rows: List<TraceRow>) = rows.all { row -> row.calls.all { it.kind == "agent" } }

@Composable
private fun treeLine() = RelayTheme.colors.faint.copy(alpha = 0.5f)

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
