package dev.relay.android.features.thread

// A trace row's words: a muted verb, then what it acted on as a file chip (its
// folder dimmed) or a code chip, as the desktop's split trace draws them.

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.thread.logic.TraceRow
import dev.relay.android.features.thread.logic.actionVerb
import dev.relay.android.features.thread.logic.baseName
import dev.relay.android.features.thread.logic.rowFailed
import dev.relay.android.features.thread.logic.shortPattern
import dev.relay.android.features.thread.logic.shortWhere
import dev.relay.android.features.thread.logic.verdictStopped
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Braces
import io.github.lyxnx.compose.ui.tablericons.outline.BrandCss3
import io.github.lyxnx.compose.ui.tablericons.outline.BrandGolang
import io.github.lyxnx.compose.ui.tablericons.outline.BrandHtml5
import io.github.lyxnx.compose.ui.tablericons.outline.BrandJavascript
import io.github.lyxnx.compose.ui.tablericons.outline.BrandKotlin
import io.github.lyxnx.compose.ui.tablericons.outline.BrandPython
import io.github.lyxnx.compose.ui.tablericons.outline.BrandReact
import io.github.lyxnx.compose.ui.tablericons.outline.BrandRust
import io.github.lyxnx.compose.ui.tablericons.outline.BrandSwift
import io.github.lyxnx.compose.ui.tablericons.outline.BrandTypescript
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.FilePencil
import io.github.lyxnx.compose.ui.tablericons.outline.FilePlus
import io.github.lyxnx.compose.ui.tablericons.outline.FileText
import io.github.lyxnx.compose.ui.tablericons.outline.Flask
import io.github.lyxnx.compose.ui.tablericons.outline.GitCommit
import io.github.lyxnx.compose.ui.tablericons.outline.Markdown
import io.github.lyxnx.compose.ui.tablericons.outline.Photo
import io.github.lyxnx.compose.ui.tablericons.outline.Search
import io.github.lyxnx.compose.ui.tablericons.outline.Terminal2
import io.github.lyxnx.compose.ui.tablericons.outline.Tool
import io.github.lyxnx.compose.ui.tablericons.outline.Trash
import io.github.lyxnx.compose.ui.tablericons.outline.World
import io.github.lyxnx.compose.ui.tablericons.outline.X

private val CHIP_SHAPE = RoundedCornerShape(5.dp)
private val WORD_GAP = 5.dp
private val EDGE_FADE = 28.dp

/** What each kind of action leads its row with. */
fun actionIcon(kind: String): ImageVector = when (kind) {
    "read" -> TablerIcons.Outline.FileText
    "image" -> TablerIcons.Outline.Photo
    "search" -> TablerIcons.Outline.Search
    "edit" -> TablerIcons.Outline.FilePencil
    "create" -> TablerIcons.Outline.FilePlus
    "delete" -> TablerIcons.Outline.Trash
    "test", "check" -> TablerIcons.Outline.Flask
    "commit", "git" -> TablerIcons.Outline.GitCommit
    "web" -> TablerIcons.Outline.World
    "run" -> TablerIcons.Outline.Terminal2
    else -> TablerIcons.Outline.Tool
}

/** Which folder a path sits in, by name. */
private fun parentName(path: String): String {
    val parts = path.split("/").filter { it.isNotEmpty() }
    return if (parts.size > 1) parts[parts.size - 2] else ""
}

private val looksLikeFile = Regex("\\.\\w+$")

/** One row's words: "Read `a.ts` L10–20", "Wrote `x.mjs` and ran it", "Tests failed ✕". `live` while its call runs: the verb says so and shines. */
@Composable
internal fun ActionLabel(row: TraceRow, live: Boolean) {
    val failed = !live && rowFailed(row)
    LabelLine {
        Verb(actionVerb(row, live), failed, if (live) Modifier.shine() else Modifier)
        ActionObject(row, withWhere = true)
        if (row.ranToo && !live) Muted("and ran it")
        if (!live) Outcome(row)
    }
}

/** Two rows one verb carries: "Read `a.ts` and `b.ts`", "Searched `x` and `y` in src". */
@Composable
internal fun PairLabel(first: TraceRow, second: TraceRow) {
    val where = first.action.where.takeIf { first.action.kind == "search" }
    val sharedWhere = where?.takeIf { it == second.action.where }
    LabelLine {
        Verb(actionVerb(first), failed = false)
        ActionObject(first, withWhere = sharedWhere == null)
        Muted("and")
        ActionObject(second, withWhere = sharedWhere == null)
        if (sharedWhere != null) Where(sharedWhere)
        if (first.ranToo) Muted("and ran them")
    }
}

/** The words on one line at their full width; what runs past the edge fades out instead of wrapping. */
@Composable
private fun LabelLine(content: @Composable () -> Unit) {
    var overflows by remember { mutableStateOf(false) }
    val fade = Modifier
        .graphicsLayer {
            clip = true
            compositingStrategy = if (overflows) CompositingStrategy.Offscreen else CompositingStrategy.Auto
        }
        .drawWithContent {
            drawContent()
            if (!overflows) return@drawWithContent
            val width = EDGE_FADE.toPx()
            drawRect(
                Brush.horizontalGradient(listOf(Color.Black, Color.Transparent), startX = size.width - width, endX = size.width),
                topLeft = Offset(size.width - width, 0f),
                size = Size(width, size.height),
                blendMode = BlendMode.DstIn,
            )
        }
    Layout(content, fade) { measurables, constraints ->
        val gap = WORD_GAP.roundToPx()
        val pieces = measurables.map { it.measure(Constraints()) }
        val full = pieces.sumOf { it.width } + gap * (pieces.size - 1).coerceAtLeast(0)
        val width = full.coerceIn(constraints.minWidth, constraints.maxWidth)
        val height = (pieces.maxOfOrNull { it.height } ?: 0).coerceIn(constraints.minHeight, constraints.maxHeight)
        overflows = full > width
        layout(width, height) {
            var x = 0
            for (piece in pieces) {
                piece.place(x, (height - piece.height) / 2)
                x += piece.width + gap
            }
        }
    }
}

/** What follows the verb: the file, pattern or program it acted on. */
@Composable
private fun ActionObject(row: TraceRow, withWhere: Boolean) {
    val a = row.action
    when (a.kind) {
        "read" -> FileChip(a.file.orEmpty(), row.lines.joinToString(", ") { "L$it" }.ifEmpty { null })
        "image", "edit", "create", "delete" -> FileChip(a.file.orEmpty())
        "search" -> {
            CodeChip(shortPattern(a.pattern.orEmpty()))
            if (withWhere && a.where != null) Where(a.where)
        }
        "run", "git" -> CodeChip(a.what.orEmpty())
        "web" -> Text(a.query.orEmpty(), maxLines = 1)
        "test" -> if (a.target != null) FileChip(a.target)
        "commit" -> {
            if (a.hash != null) CodeChip(a.hash.take(8))
            Text(a.subject.orEmpty(), maxLines = 1)
        }
    }
}

/** A test's or check's result after its words: a red ✕, or a green ✓ when it passed; nothing when it stopped first. */
@Composable
private fun Outcome(row: TraceRow) {
    val a = row.action
    if (a.kind != "test" && a.kind != "check") return
    val c = RelayTheme.colors
    if (a.failed) Icon(TablerIcons.Outline.X, "failed", size = 13.dp, tint = c.destructive)
    else if (!verdictStopped(row)) Icon(TablerIcons.Outline.Check, "passed", size = 13.dp, tint = c.success)
}

@Composable
private fun Verb(text: String, failed: Boolean, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    Text(text, modifier, color = if (failed) c.destructive else c.mutedForeground, maxLines = 1)
}

@Composable
private fun Muted(text: String) {
    Text(text, color = RelayTheme.colors.mutedForeground, maxLines = 1)
}

/** Where a search looked: a file as its chip, a folder or glob as its last two folders. */
@Composable
private fun Where(where: String) {
    Muted("in")
    val oneFile = looksLikeFile.containsMatchIn(where) && ' ' !in where
    if (oneFile) FileChip(where)
    else Text(shortWhere(LocalTrace.current.display(where)), style = chipText(), color = RelayTheme.colors.mutedForeground, maxLines = 1)
}

@Composable
private fun chipText() = RelayTheme.type.monoSm.copy(fontSize = 12.sp, lineHeight = 17.sp)

/** A file: its folder dimmed, its name, and a dimmed [note] such as the lines read. The row's icon already says what was done to it. */
@Composable
internal fun FileChip(path: String, note: String? = null) {
    val c = RelayTheme.colors
    val shown = LocalTrace.current.display(path)
    val folder = parentName(shown)
    Row(
        Modifier.background(c.tool, CHIP_SHAPE).padding(horizontal = 5.dp, vertical = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        val name = buildAnnotatedString {
            if (folder.isNotEmpty()) withStyle(SpanStyle(color = c.mutedForeground)) { append("$folder/") }
            append(baseName(shown))
        }
        androidx.compose.material3.Text(name, style = chipText(), color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (note != null) Text(note, style = chipText(), color = c.faint, maxLines = 1)
    }
}

/** A pattern or program, as typed. */
@Composable
internal fun CodeChip(text: String) {
    val c = RelayTheme.colors
    Text(
        text,
        Modifier.background(c.tool, CHIP_SHAPE).padding(horizontal = 5.dp, vertical = 1.dp),
        style = chipText(),
        color = c.foreground,
        maxLines = 1,
    )
}
