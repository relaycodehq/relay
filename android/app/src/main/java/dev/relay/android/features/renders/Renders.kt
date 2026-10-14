package dev.relay.android.features.renders

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.images.ImageCache
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.renderPage
import dev.relay.android.remote.model.HtmlRender
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.AppWindow
import java.util.concurrent.ConcurrentHashMap

// A page never changes once saved, so the HTML is kept by identity; scrolling
// back to a thread, or the list unmounting a row, doesn't fetch it again.
private val pages = ImageCache()
// The height each page last settled at, so a row mounted again opens at it.
private val settled = ConcurrentHashMap<String, Int>()
// What each render last composed, so its next relay.compose() replaces it.
private val composed = ConcurrentHashMap<String, String>()

/** Puts a page's relay.compose() text in the composer, in place of [earlier], what the page composed before. */
typealias RenderCompose = (text: String, earlier: String?) -> Unit

/** A saved page's HTML (null while loading), and whether the desktop couldn't send it. */
internal data class LoadedPage(val html: String?, val failed: Boolean)

@Composable
internal fun rememberPage(remote: Remote, chatId: String, renderId: String, page: Int): LoadedPage {
    val status by remote.status.collectAsState()
    val active by remote.active.collectAsState()
    val key = "$active:$chatId:$renderId:$page"
    val online = status.state == LinkState.Online
    val state by produceState(LoadedPage(pages.get(key), false), key, online) {
        if (value.html != null || !online) return@produceState
        val client = remote.client.value ?: return@produceState
        value = try {
            LoadedPage(pages.load(key) { client.renderPage(chatId, renderId, page) }, false)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            LoadedPage(null, true)
        }
    }
    return state
}

/** Pages the agent showed with show_html, drawn under its message; an older desktop can't send them. */
@Composable
fun MessageRenders(
    remote: Remote,
    chatId: String,
    renders: List<HtmlRender>,
    modifier: Modifier = Modifier,
    onCompose: RenderCompose? = null,
) {
    if (renders.isEmpty()) return
    val overview by remote.overview.collectAsState()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if ((overview?.bridge ?: 1) < Bridge.RENDER) {
            renders.forEach { RenderNote(it, overview?.name ?: "the computer") }
        } else {
            renders.forEach { render -> key(render.id) { RenderCard(remote, chatId, render, onCompose) } }
        }
    }
}

/** What a phone too old for the desktop's renders shows instead: where to see it. */
@Composable
private fun RenderNote(render: HtmlRender, computer: String) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(10.dp)
    val variants = render.pages.mapNotNull { it.label?.takeIf(String::isNotEmpty) }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.card)
            .ring(c.border, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Icon(TablerIcons.Outline.AppWindow, null, Modifier.padding(top = 2.dp), tint = c.mutedForeground, size = 15.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(render.title, style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), color = c.foreground, maxLines = 2)
            Text(
                (if (variants.size > 1) "${variants.size} versions: ${variants.joinToString(", ")}. " else "") +
                    "Open this thread on $computer to see ${if (variants.size > 1) "them" else "it"}.",
                style = RelayTheme.type.xs.copy(fontSize = 12.sp, lineHeight = 17.sp),
                color = c.mutedForeground,
            )
        }
    }
}

@Composable
private fun RenderCard(remote: Remote, chatId: String, render: HtmlRender, onCompose: RenderCompose?) {
    val c = RelayTheme.colors
    var index by rememberSaveable(render.id) { mutableIntStateOf(0) }
    val shape = RoundedCornerShape(10.dp)
    val tiny = RelayTheme.type.xs.copy(fontSize = 12.sp)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(render.title, Modifier.weight(1f), style = tiny, color = c.mutedForeground, maxLines = 1)
            if (render.pages.size > 1) {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    render.pages.forEachIndexed { i, page ->
                        val on = i == index
                        Text(
                            page.label?.takeIf(String::isNotEmpty) ?: "${i + 1}",
                            Modifier.pressable({ index = i }, role = Role.Tab, scale = false),
                            style = if (on) tiny.copy(fontWeight = FontWeight.SemiBold) else tiny,
                            color = if (on) c.foreground else c.mutedForeground,
                        )
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().clip(shape).ring(c.border, shape)) {
            // Another variant is another page, not a redraw of this one.
            key(index) { RenderPage(remote, chatId, render, index, onCompose) }
        }
    }
}

@Composable
private fun RenderPage(remote: Remote, chatId: String, render: HtmlRender, index: Int, onCompose: RenderCompose?) {
    val c = RelayTheme.colors
    val loaded = rememberPage(remote, chatId, render.id, index)
    val width = LocalConfiguration.current.screenWidthDp - 34
    val settledKey = "${render.id}:$index:$width"
    val estimate = settled[settledKey]
        ?: renderHeightAt(render.pages.getOrNull(index)?.heights, width.toDouble())
        ?: clampRenderHeight(RENDER_MIN_HEIGHT * 2.0)
    val theme = remember(c) { renderTheme(c) }
    val compose: ((String) -> Unit)? = remember(onCompose, chatId, render.id) {
        onCompose?.let { send ->
            val from = "$chatId:${render.id}"
            { text: String ->
                send(text, composed[from])
                composed[from] = text
            }
        }
    }
    val page = remember(loaded.html, theme) { loaded.html?.let { phoneRenderDocument(it, theme) } }
    val note = @Composable {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                if (loaded.failed) "This page couldn't be loaded." else "Loading page…",
                style = RelayTheme.type.xs.copy(fontSize = 12.sp),
                color = c.mutedForeground,
            )
        }
    }
    if (page == null) {
        Box(Modifier.fillMaxWidth().height(estimate.dp)) { note() }
        return
    }
    RenderFrame(
        page = page,
        height = estimate,
        placeholder = note,
        onCompose = compose,
        onSize = { settled[settledKey] = it },
    )
}
