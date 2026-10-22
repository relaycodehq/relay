package dev.relay.android.features.thread

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Pins the ordering relied on by ThreadViewport: request in parent measure, then measure list. */
class MeasureScrollTest {
    @get:Rule val compose = createComposeRule()

    @Test fun parentMeasureFollowsViewportShrinkInTheSameMeasure() {
        val height = mutableIntStateOf(400)
        lateinit var list: LazyListState
        var measures = 0
        var lastHeight = -1
        compose.setContent {
            list = rememberLazyListState()
            Layout(content = {
                LazyColumn(state = list) {
                    items(40, key = { "row-$it" }) {
                        Box(Modifier.fillMaxWidth().height(80.dp))
                    }
                }
            }, modifier = Modifier.height(height.intValue.dp)) { children, constraints ->
                if (lastHeight != constraints.maxHeight) {
                    lastHeight = constraints.maxHeight
                    list.requestScrollToItem(39)
                }
                val child = children.single().measure(constraints)
                measures++
                layout(child.width, child.height) { child.place(0, 0) }
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        var previousMeasures = 0
        compose.runOnIdle { previousMeasures = measures; height.intValue = 240 }
        compose.mainClock.advanceTimeByFrame()
        compose.runOnIdle {
            assertTrue("shrink measured", measures > previousMeasures)
            val info = list.layoutInfo
            val last = info.visibleItemsInfo.last()
            assertEquals(39, last.index)
            assertEquals("no delayed correction frame", info.viewportEndOffset, last.offset + last.size)
        }
    }
}
