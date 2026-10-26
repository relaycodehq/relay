package dev.relay.android.features.thread

// The code a call wrote, as its row shows it opened: a new file numbered, an
// edit as the lines it changed tinted among the ones it kept, a patch by its
// marks. Highlighted like an answer's code blocks, and so is what a read printed.

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.markdown.MAX_CODE_LINES
import dev.relay.android.features.markdown.highlight
import dev.relay.android.features.markdown.languageFor
import dev.relay.android.features.markdown.styledLine
import dev.relay.android.features.thread.logic.LineMark
import dev.relay.android.features.thread.logic.ReadCode
import dev.relay.android.features.thread.logic.WrittenLine
import dev.relay.android.features.thread.logic.WrittenView
import dev.relay.android.features.thread.logic.keptNothing
import dev.relay.android.features.thread.logic.plural
import dev.relay.android.features.thread.logic.writtenView
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.client.activityWritten
import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.WrittenCode
import dev.relay.android.ui.Text
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayColors
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.CancellationException

private sealed interface Written {
    data object Loading : Written
    /** The desktop has none to give, or couldn't be asked. */
    data object Missing : Written
    data class Files(val files: List<WrittenCode>) : Written
}

/** Fetches what [a] wrote as its row opens; [otherwise] shows when the desktop can't say. */
@Composable
internal fun WrittenCodeOf(a: AgentActivity, otherwise: @Composable () -> Unit) {
    val trace = LocalTrace.current
    val remote = LocalThreadRemote.current
    val canAsk = remote != null && trace.chatId.isNotEmpty() && (remote.overview.value?.bridge ?: 1) >= Bridge.TRACE_TREE
    if (!canAsk) return otherwise()
    val written by produceState<Written>(Written.Loading, trace.chatId, trace.messageId, a.id) {
        value = try {
            val files = remote.client.value?.activityWritten(trace.chatId, trace.messageId, a.id)
            if (files.isNullOrEmpty()) Written.Missing else Written.Files(files)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            Written.Missing
        }
    }
    when (val w = written) {
        Written.Loading -> Box(Modifier.padding(start = 21.dp).height(26.dp), contentAlignment = Alignment.CenterStart) {
            Text("Loading…", style = RelayTheme.type.xs, color = RelayTheme.colors.faint)
        }
        Written.Missing -> otherwise()
        is Written.Files -> Column(
            Modifier.padding(start = 21.dp, top = 2.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            w.files.forEach { WrittenFile(it, named = w.files.size > 1) }
        }
    }
}

/** One file's code in a box, with its size or its +/− counts on top; [named] when the call wrote several. */
@Composable
internal fun WrittenFile(code: WrittenCode, named: Boolean = false) {
    val c = RelayTheme.colors
    val view = remember(code) { writtenView(code) }
    val language = remember(code.path) { languageFor(code.path) }
    val before = remember(view, c.isDark) { highlighted(view.before, language, c) }
    val after = remember(view, c.isDark) { highlighted(view.after, language, c) }
    val nothingKept = keptNothing(code)
    Column(Modifier.fillMaxWidth().clip(Radii.smShape).background(c.code).ring(c.border, Radii.smShape)) {
        WrittenHeader(code, view, named = named || nothingKept, nothingKept)
        if (nothingKept) return@Column
        SelectionContainer(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(bottom = 6.dp)) {
                val gutter = if (view.diff) 18.dp else (view.lines.size.toString().length * 8 + 12).dp
                for (line in view.lines) {
                    val source = if (line.before) before else after
                    CodeLine(line, source.getOrNull(line.index), gutter, gutterText(line, view.diff))
                }
                if (code.cut) Text("…cut", Modifier.padding(start = gutter, top = 4.dp), style = RelayTheme.type.xs, color = c.faint)
            }
        }
    }
}

/**
 * What a read printed, boxed like a written file but with no header: the row
 * above already names the file and the lines. Numbered from [ReadCode.first]
 * when the output says where it started; otherwise the gutter stays empty.
 */
@Composable
internal fun ReadFile(read: ReadCode) {
    val c = RelayTheme.colors
    val language = remember(read.file) { languageFor(read.file) }
    val code = remember(read, c.isDark) { highlighted(read.code, language, c) }
    val lines = remember(read) { read.code.split("\n").mapIndexed { i, text -> WrittenLine(LineMark.Same, text, i) } }
    // Room for the widest number, so lines past 999 don't push their code over.
    val last = (read.first ?: 0L) + lines.size
    val gutter = (last.toString().length * 8 + 12).dp
    Column(
        Modifier.padding(start = 21.dp, top = 2.dp, bottom = 8.dp).fillMaxWidth()
            .clip(Radii.smShape).background(c.code).ring(c.border, Radii.smShape),
    ) {
        SelectionContainer(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(vertical = 6.dp)) {
                for (line in lines) {
                    val number = read.first?.let { "${it + line.index}" }.orEmpty()
                    CodeLine(line, code.getOrNull(line.index), gutter, number)
                }
            }
        }
    }
}

private fun highlighted(text: String, language: String?, c: RelayColors): List<AnnotatedString> {
    val lines = text.lineSequence().take(MAX_CODE_LINES).joinToString("\n")
    return highlight(lines, language).map { styledLine(it, c) }
}

@Composable
private fun WrittenHeader(code: WrittenCode, view: WrittenView, named: Boolean, nothingKept: Boolean) {
    val c = RelayTheme.colors
    val style = RelayTheme.type.monoSm
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (named) Text(LocalTrace.current.display(code.path), Modifier.weight(1f, fill = false), style = style, color = c.mutedForeground, maxLines = 1)
        if (nothingKept) Text("too long to keep", style = style, color = c.faint)
        else if (view.diff) {
            Text("+${view.added}", style = style, color = c.additionText)
            Text("−${view.removed}", style = style, color = c.deletionText)
        } else Text(plural(view.lines.size, "line"), style = style, color = c.faint)
    }
}

/** One line: [number] (or its +/− mark) in the gutter, then the code, tinted when it changed. */
@Composable
private fun CodeLine(line: WrittenLine, code: AnnotatedString?, gutter: Dp, number: String) {
    val c = RelayTheme.colors
    val tint = when (line.mark) {
        LineMark.Added -> c.diffAddition
        LineMark.Removed -> c.diffDeletion
        else -> Color.Transparent
    }
    val mono = RelayTheme.type.mono.copy(fontSize = 12.sp, lineHeight = 18.sp, color = c.foreground)
    if (line.mark == LineMark.Hunk) {
        Text(line.text, Modifier.padding(start = gutter, top = 4.dp, bottom = 2.dp), style = mono, color = c.faint, maxLines = 1)
        return
    }
    Row(Modifier.fillMaxWidth().background(tint)) {
        DisableSelection {
            Text(
                number,
                Modifier.width(gutter).padding(end = 6.dp),
                style = mono,
                color = gutterColor(line.mark, c),
                textAlign = TextAlign.End,
                maxLines = 1,
            )
        }
        androidx.compose.material3.Text(code ?: AnnotatedString(line.text), Modifier.weight(1f).padding(end = 10.dp), style = mono)
    }
}

private fun gutterText(line: WrittenLine, diff: Boolean): String {
    if (!diff) return "${line.index + 1}"
    return when (line.mark) {
        LineMark.Added -> "+"
        LineMark.Removed -> "−"
        else -> ""
    }
}

private fun gutterColor(mark: LineMark, c: RelayColors) = when (mark) {
    LineMark.Added -> c.additionText
    LineMark.Removed -> c.deletionText
    else -> c.faint
}
