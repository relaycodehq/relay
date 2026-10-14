package dev.relay.android.features.git

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.diff
import dev.relay.android.remote.model.DiffLine
import dev.relay.android.remote.model.RemoteDiff
import dev.relay.android.remote.model.RemoteDiffSource
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.ui.Divider
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Text
import dev.relay.android.ui.rememberIsWide
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Columns2
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow

private const val LAYOUT_KEY = "relay-diff-layout"

/** Side by side, remembered as "split" or "unified" like the Expo app's AsyncStorage key. */
private class DiffLayout(context: Context) {
    private val prefs = context.getSharedPreferences("relay-diff", Context.MODE_PRIVATE)
    var split by mutableStateOf(prefs.getString(LAYOUT_KEY, null) == "split")
        private set

    fun toggle() {
        split = !split
        prefs.edit().putString(LAYOUT_KEY, if (split) "split" else "unified").apply()
    }
}

class DiffModel(private val remote: Remote, val source: RemoteDiffSource) : ViewModel() {
    val diff = MutableStateFlow<RemoteDiff?>(null)
    val error = MutableStateFlow<String?>(null)

    suspend fun load() {
        try {
            diff.value = remote.call { diff(source) }
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
        }
    }
}

/**
 * One file's change with wrapped lines: unified, or side by side on a wide
 * screen (mobile/src/app/diff.tsx). [sourceJson] is Route.Diff's RemoteDiffSource.
 */
@Composable
fun DiffScreen(remote: Remote, sourceJson: String) {
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val model = viewModel(key = "diff:$sourceJson") { DiffModel(remote, RemoteJson.decodeFromString<RemoteDiffSource>(sourceJson)) }
    val diff by model.diff.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    LaunchedEffect(live) { if (live && model.diff.value == null) model.load() }
    val context = LocalContext.current
    val layout = remember { DiffLayout(context.applicationContext) }
    // The Expo app also hid the sidebar for two columns; here they get what the pane has.
    val wide = rememberIsWide()
    val split = wide && layout.split
    val path = model.source.path
    val name = path.substringAfterLast('/')

    Screen(name, onBack = nav.backAction, actions = {
        if (wide) IconButton(
            TablerIcons.Outline.Columns2,
            "Side by side",
            layout::toggle,
            variant = ButtonVariant.Ghost,
            tint = if (split) c.accent else c.foreground,
        )
    }) {
        if (path != name) {
            Text(
                path,
                Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp),
                style = RelayTheme.type.monoSm,
                color = c.mutedForeground,
                maxLines = 1,
                overflow = TextOverflow.StartEllipsis,
            )
            Divider()
        }
        val now = diff
        when {
            now == null && error != null -> LoadFailed(error!!, model::load)
            now == null -> Loading()
            now.binary -> Centered("A binary file. Open it on your computer to see the change.")
            else -> DiffBody(now, split)
        }
    }
}

@Composable
private fun Centered(text: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, color = RelayTheme.colors.mutedForeground, textAlign = TextAlign.Center)
    }
}

@Composable
private fun DiffBody(diff: RemoteDiff, split: Boolean) {
    val unified = remember(diff) { unifiedRows(diff) }
    val pairs = remember(diff, split) { if (split) splitRows(diff) else emptyList() }
    SelectionContainer {
        LazyColumn(Modifier.fillMaxSize()) {
            if (split) itemsIndexed(pairs, contentType = { _, r -> r::class }) { _, r ->
                when (r) {
                    is SplitRow.Hunk -> HunkHeader(r.header)
                    is SplitRow.Pair -> SplitLine(r)
                }
            } else itemsIndexed(unified, contentType = { _, r -> r::class }) { _, r ->
                when (r) {
                    is DiffRow.Hunk -> HunkHeader(r.header)
                    is DiffRow.Line -> UnifiedLine(r.line)
                }
            }
            if (diff.truncated) item {
                Text(
                    "The rest of this diff is on your computer.",
                    Modifier.fillMaxWidth().padding(16.dp),
                    color = RelayTheme.colors.mutedForeground,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

private val gutterStyle @Composable get() = RelayTheme.type.monoSm.copy(fontSize = 11.sp)
private val codeStyle @Composable get() = RelayTheme.type.mono.copy(fontSize = 12.sp, lineHeight = 18.sp)

@Composable
private fun HunkHeader(header: String) {
    Text(
        header,
        Modifier.fillMaxWidth().background(RelayTheme.colors.muted).padding(horizontal = 12.dp, vertical = 4.dp),
        style = gutterStyle,
        color = RelayTheme.colors.faint,
    )
}

@Composable
private fun lineTint(kind: String): Color = when (kind) {
    "add" -> RelayTheme.colors.diffAddition
    "del" -> RelayTheme.colors.diffDeletion
    else -> Color.Transparent
}

@Composable
private fun UnifiedLine(line: DiffLine) {
    val c = RelayTheme.colors
    Row(Modifier.fillMaxWidth().background(lineTint(line.kind)).padding(end = 8.dp)) {
        Gutter(if (line.kind == "del") line.old else line.new)
        Text(
            when (line.kind) { "add" -> "+"; "del" -> "−"; else -> " " },
            Modifier.width(16.dp),
            style = codeStyle,
            color = c.faint,
            textAlign = TextAlign.Center,
        )
        Text(line.text.ifEmpty { " " }, Modifier.weight(1f), style = codeStyle)
    }
}

@Composable
private fun Gutter(number: Int?) {
    Text(
        number?.toString() ?: "",
        Modifier.width(40.dp).padding(top = 2.dp),
        style = gutterStyle,
        color = RelayTheme.colors.faint,
        textAlign = TextAlign.End,
        maxLines = 1,
    )
}

@Composable
private fun SplitLine(row: SplitRow.Pair) {
    val c = RelayTheme.colors
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Half(row.left, row.left?.old, Modifier.weight(1f))
        Box(Modifier.width(RelayTheme.hairline).fillMaxHeight().background(c.border))
        Half(row.right, row.right?.new, Modifier.weight(1f))
    }
}

@Composable
private fun Half(line: DiffLine?, number: Int?, modifier: Modifier) {
    val back = if (line == null) RelayTheme.colors.muted else lineTint(line.kind)
    Row(modifier.fillMaxHeight().background(back).padding(end = 6.dp)) {
        Gutter(number)
        Text(line?.text?.ifEmpty { " " } ?: "", Modifier.weight(1f).padding(start = 8.dp), style = codeStyle)
    }
}
