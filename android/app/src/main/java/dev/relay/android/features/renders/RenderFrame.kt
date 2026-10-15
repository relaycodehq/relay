package dev.relay.android.features.renders

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color as AndroidColor
import android.view.MotionEvent
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayColors

/** The phone's colours as a page reads them: the desktop's CSS variable names. */
fun renderTheme(c: RelayColors) = RenderTheme(
    dark = c.isDark,
    vars = mapOf(
        "--text" to css(c.foreground),
        "--muted" to css(c.mutedForeground),
        "--surface" to css(c.background),
        "--background" to css(c.background),
        "--border" to css(c.border),
        "--hover" to css(c.hover),
        "--accent" to css(c.accent),
        "--accent-soft" to css(c.accentSoft),
        "--accent-foreground" to css(c.onAccent),
        "--danger" to css(c.destructive),
        "--code-background" to css(c.code),
        "--code-foreground" to css(c.foreground),
        "--font-sans" to "system-ui, sans-serif",
        "--font-mono" to "\"JetBrains Mono\", ui-monospace, Menlo, monospace",
    ),
)

private fun css(color: Color): String {
    val argb = color.toArgb()
    val rgb = String.format("#%06x", argb and 0xFFFFFF)
    val alpha = (argb ushr 24) and 0xFF
    return if (alpha == 0xFF) rgb else "$rgb${String.format("%02x", alpha)}"
}

/**
 * A WebView for a page from an agent ([phoneRenderDocument] makes the document)
 * with nothing to reach: no navigation, no storage, no files. [zoom] lets it
 * pinch to zoom and show its scrollbars, for a page at its real size.
 */
@SuppressLint("SetJavaScriptEnabled")
internal fun pageView(
    context: Context,
    page: String,
    zoom: Boolean,
    onMessage: (RenderMessage) -> Unit,
    onFailed: () -> Unit,
): WebView = WebView(context).apply {
    setBackgroundColor(AndroidColor.TRANSPARENT)
    isVerticalScrollBarEnabled = zoom
    isHorizontalScrollBarEnabled = zoom
    overScrollMode = View.OVER_SCROLL_NEVER
    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = false
        allowFileAccess = false
        allowContentAccess = false
        cacheMode = WebSettings.LOAD_NO_CACHE
        setSupportMultipleWindows(false)
        javaScriptCanOpenWindowsAutomatically = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        setGeolocationEnabled(false)
        // The system's font size would rescale a page laid out in CSS pixels.
        textZoom = 100
        setSupportZoom(zoom)
        builtInZoomControls = zoom
        displayZoomControls = false
        // Takes the page's viewport, whose scale limits are what a pinch may reach.
        useWideViewPort = zoom
    }
    addJavascriptInterface(
        object {
            @JavascriptInterface
            fun postMessage(data: String) {
                val message = parseRenderMessage(data) ?: return
                post { onMessage(message) }
            }
        },
        RENDER_BRIDGE,
    )
    webViewClient = object : WebViewClient() {
        // Every navigation is refused; links come through the page's click handler.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) onFailed()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            onFailed()
            return true
        }
    }
    tag = page
    loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
}

/**
 * An agent's page in the thread. It tells its height, which the frame takes;
 * [placeholder] keeps the place until it has drawn, and stands in if it can't.
 */
@Composable
fun RenderFrame(
    page: String,
    height: Int,
    modifier: Modifier = Modifier,
    placeholder: @Composable () -> Unit = {},
    onCompose: ((String) -> Unit)? = null,
    onAnswer: ((String) -> Unit)? = null,
    onSize: ((Int) -> Unit)? = null,
) {
    var measured by remember(page) { mutableStateOf<Int?>(null) }
    var failed by remember(page) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    val handle by rememberUpdatedState { message: RenderMessage ->
        when (message) {
            is RenderMessage.Size -> {
                measured = message.height
                onSize?.invoke(message.height)
            }
            is RenderMessage.Link -> runCatching { uri.openUri(message.href) }
            is RenderMessage.Compose -> onCompose?.invoke(message.text)
            is RenderMessage.Answer -> onAnswer?.invoke(message.json)
        }
    }
    val shown = measured ?: height
    val scrolls = shown >= RENDER_MAX_HEIGHT
    val inFront by rememberInFront()
    val holder = remember { arrayOfNulls<WebView>(1) }

    Box(modifier.fillMaxWidth().height(shown.dp).clipToBounds()) {
        if (measured == null || failed) placeholder()
        if (!failed) {
            AndroidView(
                factory = { context ->
                    pageView(context, page, zoom = false, onMessage = { handle(it) }, onFailed = { failed = true })
                        .also { holder[0] = it }
                },
                update = { web ->
                    if (web.tag != page) {
                        web.tag = page
                        web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
                    }
                    // Only a page past the cap scrolls itself; one that doesn't must leave the drag to the thread.
                    web.setOnTouchListener(
                        if (scrolls) {
                            View.OnTouchListener { v, e ->
                                if (e.actionMasked == MotionEvent.ACTION_DOWN) v.parent?.requestDisallowInterceptTouchEvent(true)
                                false
                            }
                        } else null,
                    )
                },
                onRelease = { web ->
                    holder[0] = null
                    web.destroy()
                },
                modifier = Modifier.matchParentSize().alpha(if (measured != null) 1f else 0f),
            )
        }
    }

    LaunchedEffect(scrolls, measured) {
        if (scrolls) holder[0]?.evaluateJavascript("document.documentElement.style.overflow='auto'", null)
    }
    // A page's animations stop while the app is in the background.
    LaunchedEffect(inFront) {
        holder[0]?.let { if (inFront) it.onResume() else it.onPause() }
    }
}
