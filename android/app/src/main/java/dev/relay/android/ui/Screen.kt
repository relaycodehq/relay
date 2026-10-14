package dev.relay.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronLeft
import dev.relay.android.ui.theme.RelayTheme

/**
 * Which edges the screen must pad for system bars. The shell narrows this:
 * a detail pane beside the sidebar doesn't pad the start edge, the sidebar
 * doesn't pad the end.
 */
val LocalScreenInsets = compositionLocalOf { WindowInsetsSides.Horizontal + WindowInsetsSides.Top + WindowInsetsSides.Bottom }

/**
 * Set by the shell on wide windows: the sidebar show/hide button, drawn at
 * the start of every TopBar in the detail pane.
 */
val LocalPaneToggle = compositionLocalOf<(@Composable () -> Unit)?> { null }

/** Set by the shell: a line under every TopBar, e.g. that the computer can't be reached. */
val LocalScreenNotice = compositionLocalOf<(@Composable () -> Unit)?> { null }

/** A 52dp header: back, a 15sp/500 title with an optional muted line, actions on the right. */
@Composable
fun TopBar(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        val toggle = LocalPaneToggle.current
        toggle?.invoke()
        if (onBack != null) IconButton(TablerIcons.Outline.ChevronLeft, "Back", onBack)
        if (leading != null) leading()
        Column(Modifier.weight(1f).padding(start = if (onBack == null && leading == null && toggle == null) 8.dp else 4.dp)) {
            Text(title, style = RelayTheme.type.base.copy(fontWeight = RelayTheme.type.label.fontWeight), maxLines = 1)
            if (subtitle != null) Text(subtitle, style = RelayTheme.type.xs, color = RelayTheme.colors.mutedForeground, maxLines = 1)
        }
        actions()
    }
}

/**
 * A screen: background, safe-drawing insets on the edges the shell says, a
 * TopBar, then the content. IME padding is the content's job (composers).
 */
@Composable
fun Screen(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    topBar: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val sides = LocalScreenInsets.current
    Column(
        modifier.fillMaxSize().background(RelayTheme.colors.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(sides)),
    ) {
        if (topBar) {
            TopBar(title, subtitle = subtitle, onBack = onBack, actions = actions)
            LocalScreenNotice.current?.invoke()
        }
        Box(Modifier.weight(1f).fillMaxWidth()) { Column(Modifier.fillMaxSize(), content = content) }
    }
}
