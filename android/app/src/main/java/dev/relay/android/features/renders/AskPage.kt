package dev.relay.android.features.renders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.HtmlRender
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme

/** A page Relay couldn't measure opens at this height, then fits itself. */
private const val UNMEASURED_HEIGHT = 240

/**
 * The page an agent asks with (ask_html), in the request card: the same page
 * the desktop shows. It hands over its answer with relay.answer() as the user
 * picks; Send gives the agent the last one, Skip tells it to decide itself.
 * [onAnswer] gets the page's JSON, or null to skip.
 */
@Composable
fun ColumnScope.AskPage(
    remote: Remote,
    chatId: String,
    page: HtmlRender,
    busy: Boolean,
    onAnswer: (String?) -> Unit,
    head: @Composable () -> Unit = {},
) {
    val c = RelayTheme.colors
    val loaded = rememberPage(remote, chatId, page.id, 0)
    var answer by remember(page.id) { mutableStateOf<String?>(null) }
    val theme = remember(c) { renderTheme(c) }
    val document = remember(loaded.html, theme) { loaded.html?.let { phoneRenderDocument(it, theme) } }
    val width = LocalConfiguration.current.screenWidthDp
    val height = clampRenderHeight((renderHeightAt(page.pages.firstOrNull()?.heights, width.toDouble()) ?: UNMEASURED_HEIGHT).toDouble())
    Column(
        Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        head()
        if (document != null) {
            RenderFrame(page = document, height = height, onAnswer = { answer = it })
        } else {
            Text(
                if (loaded.failed) "The page didn't load. Answer it on the computer." else "Loading the page…",
                style = RelayTheme.type.xs.copy(fontSize = 12.sp, lineHeight = 17.sp),
                color = c.mutedForeground,
            )
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.End),
    ) {
        Button("Skip", { onAnswer(null) }, variant = ButtonVariant.Outline, enabled = !busy)
        Button("Send answer", { answer?.let(onAnswer) }, enabled = !busy && answer != null)
    }
}
