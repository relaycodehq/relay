package dev.relay.android.features.thread

import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import dev.relay.android.features.renders.RenderFrame
import dev.relay.android.features.renders.RenderTheme
import dev.relay.android.features.renders.phoneRenderDocument
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.ThreadViewport
import dev.relay.android.ui.theme.RelayTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Real Chromium bridge callbacks and raw Android input; no network or timed HTML fixtures. */
class ThreadWebViewTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var scroll: ThreadScroll
    private val tail = mutableIntStateOf(80)
    private var measured = 0
    private fun setup() {
        compose.setContent {
            RelayTheme {
                val keys = listOf("before", "html", "tail", "end")
                val page = remember { phoneRenderDocument("<html><body style='margin:0'><div id='sample' style='height:180px'>Sample card</div></body></html>", RenderTheme(true, emptyMap())) }
                scroll = rememberThreadScroll()
                ThreadViewport(scroll, keys, ContentSignature(4, "end", tail.intValue.toLong(), 0), Modifier.background(RelayTheme.colors.background).height(500.dp)) {
                    item("before") { Box(Modifier.fillMaxWidth().height(700.dp)) }
                    item("html") { RenderFrame(page, 180, onSize = { measured = it }) }
                    item("tail") { Box(Modifier.fillMaxWidth().height(tail.intValue.dp)) }
                    item("end") { Box(Modifier.fillMaxWidth().height(1.dp)) }
                }
            }
        }
        compose.waitUntil(15_000) { measured > 0 }
        compose.waitForIdle()
    }
    private fun web(view: View = compose.activity.window.decorView): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) web(view.getChildAt(i))?.let { return it }
        return null
    }
    private fun anchor(): Pair<Any, Int> {
        lateinit var value: Pair<Any, Int>
        compose.runOnIdle { value = scroll.list.layoutInfo.visibleItemsInfo.first().let { it.key to it.offset } }
        return value
    }
    private fun raw(action: Int, downTime: Long, x: Float, y: Float) {
        val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0)
        try { InstrumentationRegistry.getInstrumentation().sendPointerSync(event) } finally { event.recycle() }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    }
    @Test fun lateHtmlSizeKeepsFollowingAtEnd() {
        setup()
        compose.runOnIdle { web()!!.evaluateJavascript("document.getElementById('sample').style.height='340px'", null) }
        compose.waitUntil(15_000) { measured >= 340 }
        compose.waitForIdle()
        compose.runOnIdle {
            val info = scroll.list.layoutInfo
            val end = info.visibleItemsInfo.last()
            assertEquals("end", end.key)
            assertTrue(kotlin.math.abs(end.offset + end.size - info.viewportEndOffset) <= 1)
        }
    }
    @Test fun rawPointerHeldOverWebViewPreventsFollowDuringGrowth() {
        setup()
        val location = IntArray(2)
        compose.runOnIdle { web()!!.getLocationOnScreen(location) }
        val x = location[0] + 12f; val y = location[1] + 12f
        val down = SystemClock.uptimeMillis()
        raw(MotionEvent.ACTION_DOWN, down, x, y)
        compose.runOnIdle { assertTrue("WebView input reaches parent viewport", scroll.touching) }
        val before = anchor()
        compose.runOnIdle { tail.intValue += 120 }
        compose.waitForIdle()
        assertEquals(before, anchor())
        raw(MotionEvent.ACTION_UP, down, x, y)
        compose.runOnIdle { assertFalse("hold releases into reading", scroll.pinned) }
        assertEquals(before, anchor())
    }
}
