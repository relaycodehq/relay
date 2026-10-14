package dev.relay.android.features.tunnel

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.tunnel.LocalUrls
import dev.relay.android.remote.tunnel.SiteAddress
import dev.relay.android.remote.tunnel.TunnelListeners
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.EmptyState
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.LocalScreenNotice
import dev.relay.android.ui.ProgressBar
import dev.relay.android.ui.Screen
import dev.relay.android.ui.TextField
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowLeft
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowRight
import io.github.lyxnx.compose.ui.tablericons.outline.PlugConnectedX
import io.github.lyxnx.compose.ui.tablericons.outline.Refresh
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A browser on the computer's localhost (`adb reverse`, through the bridge):
 * the address bar shows the desktop's own address, the page loads from the
 * phone's listener for that port. With no page yet, or while the address is
 * edited, it lists what runs there.
 */
@Composable
fun BrowserScreen(remote: Remote, tunnels: TunnelListeners, url: String?) {
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val focus = LocalFocusManager.current
    val status by remote.status.collectAsStateWithLifecycle()
    val overview by remote.overview.collectAsStateWithLifecycle()
    val client by remote.client.collectAsStateWithLifecycle()
    val name = overview?.name ?: client?.name ?: "your computer"
    val online = status.state == LinkState.Online
    val supported = rememberTunnels(remote)

    // The desktop's address of the page, kept across leaving the screen.
    var href by rememberSaveable { mutableStateOf(url?.let(LocalUrls::link)?.href) }
    val page = href?.let(LocalUrls::link)
    var wanted by remember { mutableStateOf(page) }
    var loads by remember { mutableIntStateOf(0) }
    var view by remember { mutableStateOf<WebView?>(null) }
    var text by remember { mutableStateOf(page?.shown.orEmpty()) }
    var editing by remember { mutableStateOf(page == null) }
    var loading by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var canBack by remember { mutableStateOf(false) }
    var canForward by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf<String?>(null) }

    fun open(address: SiteAddress) {
        wanted = address
        href = address.href
        text = address.shown
        editing = false
        failed = null
        loads++
        focus.clearFocus()
    }
    val opener by rememberUpdatedState(::open)

    // Connections reach the computer only while a browser is open.
    DisposableEffect(tunnels) {
        val release = tunnels.hold()
        onDispose { release() }
    }
    LaunchedEffect(view, loads) {
        val web = view ?: return@LaunchedEffect
        val address = wanted ?: return@LaunchedEffect
        val local = withContext(Dispatchers.IO) { runCatching { tunnels.listen(address.port) } }
        local.onSuccess { web.loadUrl(LocalUrls.local(address, it)) }
            .onFailure { failed = "The phone couldn't listen for localhost:${address.port}: ${it.message}" }
    }
    // Every stream ended with the link; what was on screen came back as "Not connected".
    var wasOnline by remember { mutableStateOf(online) }
    LaunchedEffect(online) {
        if (online && !wasOnline && wanted != null) view?.reload()
        wasOnline = online
    }
    val inFront by rememberInFront()
    LaunchedEffect(inFront, view) { view?.let { if (inFront) it.onResume() else it.onPause() } }

    BackHandler(enabled = editing && page != null) {
        editing = false
        text = page?.shown.orEmpty()
        focus.clearFocus()
    }
    BackHandler(enabled = !editing && canBack) { view?.goBack() }

    Screen("Browser", topBar = false) {
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            IconButton(TablerIcons.Outline.X, "Close", { nav.pop() })
            TextField(
                text,
                { text = it },
                Modifier.weight(1f).onFocusChanged { if (it.hasFocus) editing = true },
                placeholder = "localhost:port",
                mono = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onGo = { LocalUrls.typed(text)?.let(::open) }),
            )
            if (!editing && page != null) {
                IconButton(TablerIcons.Outline.ArrowLeft, "Back", { view?.goBack() }, size = ButtonSize.Sm, enabled = canBack)
                IconButton(TablerIcons.Outline.ArrowRight, "Forward", { view?.goForward() }, size = ButtonSize.Sm, enabled = canForward)
                IconButton(TablerIcons.Outline.Refresh, "Reload", {
                    failed = null
                    view?.reload()
                }, size = ButtonSize.Sm)
            }
        }
        if (loading && !editing) ProgressBar(progress.takeIf { it > 0f }, height = 2.dp)
        // The shell's line: says when the computer can't be reached.
        LocalScreenNotice.current?.invoke()
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                !supported -> EmptyState(
                    "Update Relay on $name",
                    description = "Opening its localhost here needs a newer Relay there.",
                    icon = TablerIcons.Outline.PlugConnectedX,
                )
                page != null -> {
                    AndroidView(
                        factory = { ctx ->
                            browserView(
                                ctx,
                                tunnels,
                                on = object : BrowserEvents {
                                    override fun open(address: SiteAddress) = opener(address)
                                    override fun started() {
                                        loading = true
                                        progress = 0f
                                        failed = null
                                    }
                                    override fun progress(value: Float) {
                                        progress = value
                                    }
                                    override fun finished(web: WebView) {
                                        loading = false
                                        canBack = web.canGoBack()
                                        canForward = web.canGoForward()
                                    }
                                    override fun moved(web: WebView, url: String) {
                                        canBack = web.canGoBack()
                                        canForward = web.canGoForward()
                                        val at = LocalUrls.desktop(url, tunnels::desktopPort) ?: return
                                        href = at.href
                                        if (!editing) text = at.shown
                                    }
                                    override fun failed(description: String) {
                                        failed = description
                                        loading = false
                                    }
                                },
                            ).also { view = it }
                        },
                        onRelease = { web ->
                            view = null
                            web.destroy()
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                    failed?.let { reason ->
                        EmptyState(
                            "Couldn't load ${page.shown}",
                            Modifier.fillMaxSize().background(c.background),
                            description = if (online) reason else "Not connected to $name.",
                            action = { Button("Try again", { open(page) }, variant = ButtonVariant.Outline, size = ButtonSize.Sm) },
                        )
                    }
                }
            }
            if (supported && (editing || page == null)) {
                SitesPanel(remote, name, text, ::open)
            }
        }
    }
}

private interface BrowserEvents {
    fun open(address: SiteAddress)
    fun started()
    fun progress(value: Float)
    fun finished(web: WebView)
    fun moved(web: WebView, url: String)
    fun failed(description: String)
}

/**
 * A WebView that stays on the computer's localhost: a link to another port
 * there opens through its own listener, anything else in the phone's own
 * browser or app for it.
 */
@SuppressLint("SetJavaScriptEnabled")
private fun browserView(context: Context, tunnels: TunnelListeners, on: BrowserEvents) = WebView(context).apply {
    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        setSupportMultipleWindows(false)
        javaScriptCanOpenWindowsAutomatically = false
        useWideViewPort = true
        loadWithOverviewMode = true
        setSupportZoom(true)
        builtInZoomControls = true
        displayZoomControls = false
    }
    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val target = request.url.toString()
            if (LocalUrls.desktop(target, tunnels::desktopPort) != null) return false
            LocalUrls.link(target)?.let {
                on.open(it)
                return true
            }
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = on.started()

        override fun onPageFinished(view: WebView, url: String?) = on.finished(view)

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            if (url != null) on.moved(view, url)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) on.failed(error.description?.toString() ?: "It didn't load.")
        }
    }
    webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) = on.progress(newProgress / 100f)
    }
}
