package dev.relay.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.junit4.v2.createComposeRule
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.ScrollMode
import dev.relay.android.features.thread.scroll.ThreadViewport
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** History responses are explicit fixture events; real viewport, native rows and restore policy. */
class ThreadHistoryRecoveryTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var scroll: ThreadScroll
    private lateinit var scope: CoroutineScope
    private val older = mutableStateOf(emptyList<String>())
    private val historyResult = mutableStateOf(HistoryLoadResult(0, 20, true))
    private val tailVersion = mutableLongStateOf(1)
    private val tailRows = mutableIntStateOf(0)
    private val tailHeight = mutableIntStateOf(100)

    private fun setup() {
        compose.setContent {
            RelayTheme {
                scope = rememberCoroutineScope()
                val keys = listOf("earlier") + older.value + (0 until 20).map { "message-$it" } +
                    (0 until tailRows.intValue).map { "new-tail-$it" } + listOf("tail", "bottom")
                scroll = rememberThreadScroll()
                ThreadViewport(scroll, keys, ContentSignature(keys.size, "bottom", tailVersion.longValue, 0),
                    Modifier.background(RelayTheme.colors.background).height(500.dp),
                    historyResult = historyResult.value) {
                    item("earlier") { Box(Modifier.fillMaxWidth().height(60.dp)) }
                    items(older.value, key = { it }) { paragraph(it) }
                    items(20, key = { "message-$it" }) { paragraph("message-$it") }
                    items(tailRows.intValue, key = { "new-tail-$it" }) { paragraph("new-tail-$it") }
                    item("tail") { Box(Modifier.fillMaxWidth().height(tailHeight.intValue.dp)) }
                    item("bottom") { Box(Modifier.fillMaxWidth().height(1.dp)) }
                }
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
    }

    @Composable private fun paragraph(key: String) {
        Markdown("$key. " + "History recovery must leave the paragraph in the same place. ".repeat(3), native = true)
    }
    private fun frame() { compose.mainClock.advanceTimeByFrame(); compose.waitForIdle() }
    private fun readEarlier() {
        compose.runOnIdle {
            scroll.readerScroll.onPreScroll(Offset(0f, 6f), NestedScrollSource.UserInput)
            scroll.list.requestScrollToItem(0, 13)
        }
        frame()
        compose.runOnIdle { scope.launch { scroll.readerScroll.onPostFling(Velocity.Zero, Velocity.Zero) } }
        frame()
    }
    private fun visible(): List<Pair<String, Int>> {
        lateinit var rows: List<Pair<String, Int>>
        compose.runOnIdle { rows = scroll.list.layoutInfo.visibleItemsInfo.map { it.key.toString() to it.offset } }
        return rows
    }
    private fun requestEarlier() {
        compose.runOnIdle {
            scroll.preserveForPrepend(requestedHistory = 40, afterRequest = historyResult.value.request)
        }
        frame()
        compose.runOnIdle { assertTrue("load holds pending anchor", scroll.currentMode is ScrollMode.Restoring) }
    }
    private fun assertAtEnd() {
        compose.runOnIdle {
            val info = scroll.list.layoutInfo
            val last = info.visibleItemsInfo.last()
            assertEquals("bottom", last.key)
            assertTrue(kotlin.math.abs(last.offset + last.size - info.viewportEndOffset) <= 1)
        }
    }

    @Test fun failedEarlierLoadReleasesRestoreAndRetryPreservesMessageCoordinates() {
        setup(); readEarlier()
        val before = visible()
        val message = before.first { it.first.startsWith("message-") }
        requestEarlier()
        compose.runOnIdle { tailRows.intValue++; tailVersion.longValue++ }
        frame()
        assertEquals("streaming new keys do not complete history loading", before, visible())
        compose.runOnIdle { assertTrue(scroll.currentMode is ScrollMode.Restoring); historyResult.value = HistoryLoadResult(1, 40, false) }
        frame()
        compose.runOnIdle { assertEquals("failure exits pending restore", ScrollMode.Reading, scroll.currentMode) }
        assertEquals("failed fetch never issues a position correction", before, visible())
        compose.runOnIdle { tailHeight.intValue += 80; tailVersion.longValue++ }; frame()
        assertEquals(before, visible())

        requestEarlier()
        compose.runOnIdle { tailRows.intValue++; tailVersion.longValue++ }
        frame()
        compose.runOnIdle { assertTrue("previous same-size failure cannot cancel retry", scroll.currentMode is ScrollMode.Restoring) }
        assertEquals(before, visible())
        compose.runOnIdle { older.value = listOf("older-0", "older-1"); historyResult.value = HistoryLoadResult(2, 40, true) }
        frame()
        compose.runOnIdle { assertEquals(ScrollMode.Reading, scroll.currentMode) }
        assertEquals("retry preserves message coordinate across persistent earlier button", message.second,
            visible().first { it.first == message.first }.second)
    }

    @Test fun explicitBottomAfterFailureFollowsGrowthAndIgnoresLateHistorySuccess() {
        setup(); readEarlier(); requestEarlier()
        compose.runOnIdle { historyResult.value = HistoryLoadResult(1, 40, false) }; frame()
        compose.runOnIdle { assertEquals(ScrollMode.Reading, scroll.currentMode); scroll.toBottom("test_recovery") }
        frame(); assertAtEnd()
        compose.runOnIdle { tailHeight.intValue += 160; tailVersion.longValue++ }; frame(); assertAtEnd()
        compose.runOnIdle { older.value = listOf("older-0", "older-1"); historyResult.value = HistoryLoadResult(2, 40, true) }
        frame(); assertAtEnd()
        compose.runOnIdle { assertTrue(scroll.pinned) }
    }
}
