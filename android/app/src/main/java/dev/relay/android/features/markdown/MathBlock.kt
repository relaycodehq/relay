package dev.relay.android.features.markdown

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import dev.relay.android.features.renders.RenderFrame
import dev.relay.android.features.renders.renderTheme
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A formula's source, for until it is typeset and where it can't be. */
@Composable
private fun Source(tex: String, modifier: Modifier = Modifier) {
    Text(
        tex,
        modifier,
        style = RelayTheme.type.mono.copy(fontSize = 12.5.sp, lineHeight = 18.sp),
        color = RelayTheme.colors.mutedForeground,
    )
}

/**
 * A display formula, typeset by KaTeX in a WebView of its own. While it is
 * still arriving, and if it can't be drawn, its source shows instead.
 */
@Composable
internal fun MathBlock(tex: String, closed: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val katex by produceState<KatexAssets?>(null) {
        value = withContext(Dispatchers.IO) { runCatching { katexAssets(context.assets) }.getOrNull() }
    }
    val colors = RelayTheme.colors
    val assets = katex
    val page = remember(closed, tex, colors, assets) {
        if (closed && tex.isNotBlank() && assets != null) mathDocument(tex, renderTheme(colors), assets) else null
    }
    if (page == null) Source(tex, modifier)
    else RenderFrame(page, height = 44, modifier = modifier, placeholder = { Source(tex) })
}
