package dev.relay.android.features.renders

import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.HtmlRender
import dev.relay.android.ui.Divider
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.LocalPaneToggle
import dev.relay.android.ui.Text
import dev.relay.android.ui.TopBar
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.X

/**
 * A show_html page over the whole screen, as the desktop's Expand: at its real
 * size rather than shrunk into the thread, scrolling itself and pinched to
 * zoom. Switching variants here switches the card's too.
 */
@Composable
internal fun RenderStage(
    remote: Remote,
    chatId: String,
    render: HtmlRender,
    index: Int,
    onIndex: (Int) -> Unit,
    onCompose: ((String) -> Unit)?,
    onClose: () -> Unit,
) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val c = RelayTheme.colors
        SystemBars(c.isDark)
        CompositionLocalProvider(LocalPaneToggle provides null) {
            Column(Modifier.fillMaxSize().background(c.background).windowInsetsPadding(WindowInsets.safeDrawing)) {
                TopBar(render.title, actions = { IconButton(TablerIcons.Outline.X, "Close", onClose) })
                if (render.pages.size > 1) Variants(
                    render, index, onIndex,
                    Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                    style = RelayTheme.type.sm,
                )
                Divider()
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    key(index) { StagePage(remote, chatId, render, index, onCompose) }
                }
            }
        }
    }
}

/** The dialog's own window draws the system bars; their icons follow the theme as the app's do. */
@Composable
private fun SystemBars(dark: Boolean) {
    val view = LocalView.current
    SideEffect {
        val window = (view.parent as? DialogWindowProvider)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
}

@Composable
private fun StagePage(remote: Remote, chatId: String, render: HtmlRender, index: Int, onCompose: ((String) -> Unit)?) {
    val c = RelayTheme.colors
    val loaded = rememberPage(remote, chatId, render.id, index)
    val theme = remember(c) { renderTheme(c) }
    val page = remember(loaded.html, theme) { loaded.html?.let { phoneRenderDocument(it, theme, fit = false) } }
    var failed by remember(page) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    val handle by rememberUpdatedState { message: RenderMessage ->
        when (message) {
            is RenderMessage.Link -> runCatching { uri.openUri(message.href) }
            is RenderMessage.Compose -> onCompose?.invoke(message.text)
            else -> Unit
        }
    }
    val inFront by rememberInFront()
    val holder = remember { arrayOfNulls<WebView>(1) }
    if (page == null || failed) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(if (loaded.failed || failed) "This page couldn't be loaded." else "Loading page…", color = c.mutedForeground)
        }
        return
    }
    AndroidView(
        factory = { context ->
            pageView(context, page, zoom = true, onMessage = { handle(it) }, onFailed = { failed = true })
                .also { holder[0] = it }
        },
        update = { web ->
            if (web.tag != page) {
                web.tag = page
                web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
            }
        },
        onRelease = { web ->
            holder[0] = null
            web.destroy()
        },
        modifier = Modifier.fillMaxSize(),
    )
    // A page's animations stop while the app is in the background.
    LaunchedEffect(inFront) {
        holder[0]?.let { if (inFront) it.onResume() else it.onPause() }
    }
}
