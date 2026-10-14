package dev.relay.android.features.markdown

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayColors
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Copy
import kotlinx.coroutines.launch

/** The first lines only; a phone isn't where to read a generated bundle. */
const val MAX_CODE_LINES = 5000

/** An answer's code block shows this many lines until it is opened up. */
internal const val FOLDED_CODE_LINES = 15

/** Blocks shorter than this read better without line numbers. */
private const val NUMBERED_FROM = 5

/** prism-react-renderer's One Dark and One Light, by token kind. */
private fun colorOf(kind: TokenKind, c: RelayColors): Color {
    val hex = if (c.isDark) when (kind) {
        TokenKind.Comment -> 0xFF5C6370
        TokenKind.Keyword -> 0xFFC678DD
        TokenKind.Text -> 0xFF98C379
        TokenKind.Number, TokenKind.Attribute -> 0xFFD19A66
        TokenKind.Function -> 0xFF61AFEF
        TokenKind.Type -> 0xFFE5C07B
        TokenKind.Property, TokenKind.Tag -> 0xFFE06C75
        TokenKind.Operator -> 0xFF56B6C2
        TokenKind.Plain, TokenKind.Punctuation -> return c.foreground
    } else when (kind) {
        TokenKind.Comment -> 0xFFA0A1A7
        TokenKind.Keyword -> 0xFFA626A4
        TokenKind.Text -> 0xFF50A14F
        TokenKind.Number, TokenKind.Attribute -> 0xFF986801
        TokenKind.Function -> 0xFF4078F2
        TokenKind.Type -> 0xFFC18401
        TokenKind.Property, TokenKind.Tag -> 0xFFE45649
        TokenKind.Operator -> 0xFF0184BC
        TokenKind.Plain, TokenKind.Punctuation -> return c.foreground
    }
    return Color(hex)
}

private fun styled(line: List<CodeToken>, c: RelayColors): AnnotatedString = buildAnnotatedString {
    if (line.isEmpty()) append(" ")
    for (token in line) {
        val color = colorOf(token.kind, c)
        if (color == c.foreground) append(token.text) else withStyle(SpanStyle(color = color)) { append(token.text) }
    }
}

/** A highlighted code block in an answer: numbered, copyable, long ones folded. */
@Composable
internal fun CodeBlock(language: String, code: String, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val lines = remember(code, language) {
        highlight(code.lineSequence().take(MAX_CODE_LINES).joinToString("\n"), languageFor(language))
    }
    val text = remember(lines, c.isDark) { lines.map { styled(it, c) } }
    var open by rememberSaveable { mutableStateOf(false) }
    val folded = !open && text.size > FOLDED_CODE_LINES + 3
    val shown = if (folded) text.subList(0, FOLDED_CODE_LINES) else text
    val numbered = text.size >= NUMBERED_FROM
    val gutter = (text.size.toString().length * 8 + 12).dp
    val clipboard = LocalClipboard.current
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()

    Column(
        modifier
            .fillMaxWidth()
            .clip(Radii.smShape)
            .background(c.code)
            .ring(c.border, Radii.smShape),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                language.ifEmpty { "text" },
                Modifier.weight(1f),
                style = RelayTheme.type.monoSm,
                color = c.faint,
                maxLines = 1,
            )
            IconButton(
                TablerIcons.Outline.Copy,
                "Copy code",
                onClick = {
                    scope.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("code", code)))
                        toasts.show("Copied")
                    }
                },
                size = ButtonSize.Xs,
                tint = c.mutedForeground,
                haptic = Haptic.Selection,
            )
        }
        SelectionContainer {
            Box(Modifier.horizontalScroll(rememberScrollState()).padding(start = if (numbered) 0.dp else 12.dp, end = 12.dp, bottom = 10.dp)) {
                Column {
                    shown.forEachIndexed { i, line -> CodeLine(i, line, if (numbered) gutter else null, c) }
                }
            }
        }
        if (folded) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .pressable({ open = true }, scale = false)
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Show all ${text.size} lines", style = RelayTheme.type.label, color = c.mutedForeground)
            }
        }
    }
}

@Composable
private fun CodeLine(index: Int, line: AnnotatedString, gutter: androidx.compose.ui.unit.Dp?, c: RelayColors) {
    Row(horizontalArrangement = Arrangement.Start) {
        if (gutter != null) {
            // Numbers aren't part of the copied or selected text.
            androidx.compose.foundation.text.selection.DisableSelection {
                Text(
                    "${index + 1}",
                    Modifier.width(gutter).padding(end = 8.dp, top = 2.dp),
                    style = RelayTheme.type.monoSm.copy(fontSize = 11.sp, lineHeight = 16.sp),
                    color = c.faint,
                    textAlign = TextAlign.End,
                    maxLines = 1,
                )
            }
        }
        androidx.compose.material3.Text(
            line,
            style = RelayTheme.type.mono.copy(fontSize = 12.sp, lineHeight = 18.sp, color = c.foreground),
            softWrap = false,
            overflow = TextOverflow.Clip,
        )
    }
}

/** A read-only file, highlighted by its extension, one numbered line per row. */
@Composable
fun Code(code: String, path: String, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val lines = remember(code, path) {
        highlight(code.lineSequence().take(MAX_CODE_LINES).joinToString("\n"), languageFor(path))
    }
    val text = remember(lines, c.isDark) { lines.map { styled(it, c) } }
    val gutter = (text.size.toString().length * 8 + 12).dp
    SelectionContainer(modifier) {
        LazyColumn {
            itemsIndexed(text) { i, line ->
                Box(Modifier.padding(end = 10.dp)) { WrappedLine(i, line, gutter, c) }
            }
        }
    }
}

@Composable
private fun WrappedLine(index: Int, line: AnnotatedString, gutter: androidx.compose.ui.unit.Dp, c: RelayColors) {
    Row {
        androidx.compose.foundation.text.selection.DisableSelection {
            Text(
                "${index + 1}",
                Modifier.width(gutter).padding(end = 8.dp, top = 2.dp),
                style = RelayTheme.type.monoSm.copy(fontSize = 11.sp, lineHeight = 16.sp),
                color = c.faint,
                textAlign = TextAlign.End,
                maxLines = 1,
            )
        }
        androidx.compose.material3.Text(
            line,
            Modifier.weight(1f),
            style = RelayTheme.type.mono.copy(fontSize = 12.sp, lineHeight = 18.sp, color = c.foreground),
        )
    }
}
