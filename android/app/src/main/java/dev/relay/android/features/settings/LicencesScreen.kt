package dev.relay.android.features.settings

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.ui.ListInset
import dev.relay.android.ui.Screen
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** What scripts/android-notices.mjs writes: `# ` starts a section, a blank line a paragraph. */
internal const val NOTICES_ASSET = "third-party-notices.txt"

internal data class NoticeBlock(val text: String, val heading: Boolean)

internal fun noticeBlocks(text: String): List<NoticeBlock> =
    text.split(Regex("\n\\s*\n")).map { it.trim() }.filter { it.isNotEmpty() }.map {
        if (it.startsWith("# ")) NoticeBlock(it.removePrefix("# "), heading = true) else NoticeBlock(it, heading = false)
    }

/** The libraries, fonts and assets in this APK, with their licence texts. */
@Composable
fun LicencesScreen() {
    val nav = LocalNavigator.current
    val context = LocalContext.current
    val blocks by produceState<List<NoticeBlock>>(emptyList()) {
        value = withContext(Dispatchers.IO) {
            noticeBlocks(context.assets.open(NOTICES_ASSET).bufferedReader().use { it.readText() })
        }
    }
    val c = RelayTheme.colors
    Screen("Open-source licences", onBack = nav.backAction) {
        SelectionContainer {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = ListInset, end = ListInset, bottom = 24.dp)) {
                items(blocks) { block ->
                    if (block.heading) Text(
                        block.text,
                        Modifier.padding(top = 20.dp, bottom = 8.dp),
                        style = RelayTheme.type.base.copy(fontWeight = FontWeight.Medium),
                        color = c.foreground,
                    )
                    else Text(
                        block.text,
                        Modifier.padding(bottom = 10.dp),
                        style = RelayTheme.type.sm,
                        color = c.mutedForeground,
                    )
                }
            }
        }
    }
}
