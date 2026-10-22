package dev.relay.android.features.thread

import android.os.Debug
import android.util.Log
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.ThreadViewport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Structural cost checks, not an emulator timing benchmark. */
class ThreadLayoutCostTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var scroll: ThreadScroll
    private val rows = (0 until 200).map { "row-$it" }
    private var compositions = 0
    private var rowMeasures = 0
    private var rowGeometryChanges = 0
    private var rowMeasureCpuNanos = 0L
    private var dockMeasures = 0

    @Test fun ordinaryReadingScrollMeasuresChildrenWithoutRemeasuringTheViewport() {
        compose.setContent {
            scroll = rememberThreadScroll()
            SideEffect { compositions++ }
            ThreadViewport(scroll, rows, ContentSignature(rows.size, rows.last(), 0, 0),
                Modifier.width(360.dp).height(480.dp), dock = {
                    Layout(content = { Box(Modifier.fillMaxWidth().height(64.dp)) }) { children, constraints ->
                        dockMeasures++
                        val child = children.single().measure(constraints)
                        layout(child.width, child.height) { child.place(0, 0) }
                    }
                }) {
                items(rows.size, key = { rows[it] }) { measuredRow() }
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        compose.runOnIdle {
            scroll.readerScroll.onPreScroll(Offset(0f, 6f), NestedScrollSource.UserInput)
            scroll.list.requestScrollToItem(140, 12)
        }
        repeat(4) { frame() }

        var initialMeasures = 0L
        var initialCompositions = 0
        var initialRowMeasures = 0
        var initialGeometry = 0
        var initialCpu = 0L
        var initialDockMeasures = 0
        var initialIndex = 0
        compose.runOnIdle {
            assertTrue("fixture is reading", scroll.reading)
            initialMeasures = scroll.diagnostics.viewportMeasures
            initialCompositions = compositions
            initialRowMeasures = rowMeasures
            initialGeometry = rowGeometryChanges
            initialCpu = rowMeasureCpuNanos
            initialDockMeasures = dockMeasures
            initialIndex = scroll.list.firstVisibleItemIndex
        }

        repeat(80) {
            compose.runOnIdle {
                assertTrue("fixture has older content", scroll.list.canScrollBackward)
                assertTrue("delta moved the list", scroll.list.dispatchRawDelta(-48f) < 0f)
            }
            frame()
        }

        compose.runOnIdle {
            val viewportDelta = scroll.diagnostics.viewportMeasures - initialMeasures
            val compositionDelta = compositions - initialCompositions
            val rowDelta = rowMeasures - initialRowMeasures
            val geometryDelta = rowGeometryChanges - initialGeometry
            val cpuDelta = rowMeasureCpuNanos - initialCpu
            val dockDelta = dockMeasures - initialDockMeasures
            val report = "frames=80 viewportMeasures=$viewportDelta compositions=$compositionDelta " +
                "rowMeasures=$rowDelta rowGeometryChanges=$geometryDelta dockMeasures=$dockDelta " +
                "rowMeasureCpuNanos=$cpuDelta firstIndex=$initialIndex->${scroll.list.firstVisibleItemIndex}"
            Log.i("RelayScrollLayoutCost", report)
            assertTrue("actual scrolling occurred: $report", scroll.list.firstVisibleItemIndex < initialIndex)
            assertTrue("incoming lazy rows were measured: $report", rowDelta > 0)
            assertTrue("child geometry changed across frames: $report", geometryDelta >= 80)
            assertEquals("scrolling must not recompose the viewport call site: $report", 0, compositionDelta)
            assertTrue("child scroll must not invalidate parent measurement: $report", viewportDelta <= 2)
            assertEquals("unchanged dock keeps its cached measurement: $report", 0, dockDelta)
        }
    }

    private fun frame() {
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
    }

    @Composable private fun measuredRow() {
        Layout(modifier = Modifier.fillMaxWidth().height(64.dp).onGloballyPositioned { rowGeometryChanges++ },
            content = {}) { _, constraints ->
            val cpuStart = Debug.threadCpuTimeNanos()
            rowMeasures++
            val result = layout(constraints.maxWidth, constraints.minHeight) {}
            rowMeasureCpuNanos += Debug.threadCpuTimeNanos() - cpuStart
            result
        }
    }
}
