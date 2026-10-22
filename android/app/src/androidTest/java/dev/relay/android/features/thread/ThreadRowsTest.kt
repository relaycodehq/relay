package dev.relay.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.activity.ComponentActivity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import dev.relay.android.features.markdown.MarkdownBlockView
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.ThreadViewport
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.HtmlRender
import dev.relay.android.remote.model.HtmlRenderPage
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Production row keys/parsing and native paragraph rendering; local message models only. */
class ThreadRowsTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var scroll: ThreadScroll
    private lateinit var scope: CoroutineScope
    private var rows = emptyList<ThreadMessageRow>()
    private val renders = mutableStateOf(emptyList<HtmlRender>())
    private val version = mutableLongStateOf(1)
    private val earlier = mutableStateOf(false)
    private val extraTail = mutableStateOf(false)
    private val endChrome = mutableIntStateOf(10)
    private val withMath = mutableStateOf(false)
    private val heights = mutableMapOf<String, Int>()
    private fun setup() {
        compose.setContent {
            RelayTheme {
                scope = rememberCoroutineScope()
                val parser = remember { ThreadBodyRows() }
                val body = (if (withMath.value) "$$\n\\frac{1}{2} + \\sum_{n=1}^{10} n\n$$\n\n" else "") + (0 until 30).joinToString("\n\n") { "Paragraph $it. " + "Read this same text without it moving. ".repeat(3) } + (if (extraTail.value) "\n\nNew streaming paragraph" else "")
                val message = ChatMessage("sample", "assistant", body, "complete", 0L, "codex", version.longValue, renders = renders.value)
                rows = parser.rows(listOf(message))
                val prefix = if (earlier.value) listOf("earlier", "older-a", "older-b") else listOf("earlier")
                val keys = prefix + rows.map { it.key } + listOf("chrome", "end")
                scroll = rememberThreadScroll()
                ThreadViewport(scroll, keys, ContentSignature(keys.size, "end", version.longValue, endChrome.intValue), Modifier.background(RelayTheme.colors.background).height(500.dp)) {
                    items(prefix, key = { it }) { Box(Modifier.fillMaxWidth().height(60.dp)) }
                    items(rows, key = { it.key }) { row ->
                        when (row) {
                            is ThreadMessageRow.Block -> MarkdownBlockView(row.block, Modifier.onSizeChanged { heights[row.key] = it.height })
                            is ThreadMessageRow.Render -> Box(Modifier.fillMaxWidth().height(230.dp))
                            is ThreadMessageRow.Content -> Box(Modifier.fillMaxWidth().height(20.dp))
                        }
                    }
                    item("chrome") { Box(Modifier.fillMaxWidth().height(endChrome.intValue.dp)) }
                    item("end") { Box(Modifier.fillMaxWidth().height(1.dp)) }
                }
            }
        }
        compose.waitForIdle(); compose.mainClock.autoAdvance = false
    }
    private fun frame() { compose.mainClock.advanceTimeByFrame(); compose.waitForIdle() }
    private fun read(index: Int) {
        compose.runOnIdle {
            scroll.readerScroll.onPreScroll(Offset(0f, 6f), NestedScrollSource.UserInput)
            scroll.list.requestScrollToItem(index, 13)
        }
        frame()
        compose.runOnIdle { scope.launch { scroll.readerScroll.onPostFling(Velocity.Zero, Velocity.Zero) } }; frame()
    }
    private fun anchor(): Pair<String, Int> {
        lateinit var result: Pair<String, Int>
        compose.runOnIdle { result = scroll.list.layoutInfo.visibleItemsInfo.first().let { it.key.toString() to it.offset } }
        return result
    }
    @Test fun addingAndRemovingRenderAboveParagraphKeepsParagraphAnchor() {
        setup(); read(15); val before = anchor()
        compose.runOnIdle { renders.value = listOf(HtmlRender("new-card", "Sample", listOf(HtmlRenderPage()), 0)); version.longValue++ }
        frame(); assertEquals(before, anchor())
        compose.runOnIdle { renders.value = emptyList(); version.longValue++ }; frame(); assertEquals(before, anchor())
    }
    @Test fun earlierButtonDoesNotBecomeAnchorWhenHistoryIsPrepended() {
        setup(); read(0)
        // Capture the first message key even when the persistent earlier row is visible.
        lateinit var expected: Pair<String, Int>
        compose.runOnIdle {
            expected = scroll.list.layoutInfo.visibleItemsInfo.first { it.key != "earlier" }.let { it.key.toString() to it.offset }
            scroll.preserveForPrepend()
        }
        val whileLoading = anchor()
        compose.runOnIdle { extraTail.value = true; version.longValue++ }; frame()
        assertEquals("tail insert must not acknowledge history loading", whileLoading, anchor())
        frame() // Loading can take multiple frames; do not consume pending restoration on old rows.
        compose.runOnIdle { earlier.value = true }; frame()
        compose.runOnIdle {
            val restored = scroll.list.layoutInfo.visibleItemsInfo.first { it.key == expected.first }
            assertEquals(expected.second, restored.offset)
        }
    }
    @Test fun giantQueueChromeStillFollowsSeparateBottomSentinel() {
        endChrome.intValue = 1400
        setup()
        repeat(3) {
            compose.runOnIdle { endChrome.intValue += 100 }; frame()
            compose.runOnIdle {
                val info = scroll.list.layoutInfo; val last = info.visibleItemsInfo.last()
                assertEquals("end", last.key)
                assertEquals(info.viewportEndOffset, last.offset + last.size)
            }
        }
    }
    @Test fun localKatexMathRetainsMeasuredHeightAcrossOffscreenRevisit() {
        withMath.value = true
        setup(); compose.mainClock.autoAdvance = true; read(2)
        val math = rows.filterIsInstance<ThreadMessageRow.Block>().first { it.block.block is dev.relay.android.features.markdown.MdBlock.Math }.key
        var typeset = false
        compose.waitUntil(15_000) {
            compose.runOnIdle { findWebView(compose.activity.window.decorView)?.evaluateJavascript("Boolean(document.querySelector('.katex'))") { typeset = it == "true" } }
            typeset
        }
        compose.waitForIdle()
        val initial = heights.getValue(math)
        read(18); val reader = anchor()
        compose.runOnIdle { version.longValue++ }; frame(); assertEquals(reader, anchor())
        read(2)
        assertEquals("settled math reuses measured frame", initial, heights.getValue(math))
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) findWebView(view.getChildAt(i))?.let { return it }
        return null
    }

}
