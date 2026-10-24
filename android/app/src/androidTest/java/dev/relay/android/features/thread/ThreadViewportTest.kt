package dev.relay.android.features.thread

import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.Velocity
import dev.relay.android.features.thread.scroll.StableGeometryState
import dev.relay.android.features.thread.scroll.stableGeometry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.unit.dp
import dev.relay.android.features.images.AnswerImageFrame
import dev.relay.android.features.images.LoadedImage
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.ThreadViewport
import dev.relay.android.ui.theme.RelayTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Local fixture exercises the production viewport/native renderers without pairing or a server. */
class ThreadViewportTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var scroll: ThreadScroll
    private lateinit var scope: CoroutineScope
    private val restoration = StateRestorationTester(compose)
    private val headerGeometry = StableGeometryState()
    private val prefix = mutableStateOf(listOf<String>())
    private val growth = mutableIntStateOf(80)
    private val dock = mutableIntStateOf(100)
    private val viewport = mutableIntStateOf(600)
    private val width = mutableIntStateOf(360)
    private val fontScale = mutableFloatStateOf(1f)
    private val image = mutableStateOf(LoadedImage(null, false))
    private val header = mutableIntStateOf(90)
    private val positions = mutableMapOf<String, Pair<Int, Int>>()

    private fun setup() {
        restoration.setContent {
            scope = rememberCoroutineScope()
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale.floatValue)) {
            RelayTheme {
                val keys = prefix.value + (0 until 30).map { "row-$it" } + listOf("image", "header", "tail", "end")
                scroll = rememberThreadScroll()
                ThreadViewport(scroll, keys, ContentSignature(keys.size, keys.last(), growth.intValue.toLong(), 0),
                    Modifier.background(RelayTheme.colors.background).width(width.intValue.dp).height(viewport.intValue.dp).testTag("viewport"),
                    dock = { Box(Modifier.fillMaxWidth().height(dock.intValue.dp)) }) {
                    items(prefix.value, key = { it }) { row(it, 50) }
                    items(30, key = { "row-$it" }) { i ->
                        Box(measured("row-$i")) {
                            Markdown("Paragraph $i. " + "Native text should keep its measured size when it returns to the viewport. ".repeat(3), native = true)
                        }
                    }
                    item("image") { AnswerImageFrame(image.value, "Sample", {}, measured("image")) }
                    item("header") { Box(measured("header").stableGeometry(headerGeometry, scroll.reading)) { Box(Modifier.height(header.intValue.dp)) } }
                    item("tail") { row("tail", growth.intValue) }
                    item("end") { row("end", 1) }
                }
            }
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
    }

    private fun measured(key: String) = Modifier.fillMaxWidth().onGloballyPositioned {
        positions[key] = it.positionInRoot().y.toInt() to it.size.height
    }
    @Composable private fun row(key: String, height: Int) { Box(measured(key).height(height.dp)) }
    private fun frame() { compose.mainClock.advanceTimeByFrame(); compose.waitForIdle() }
    private fun read(index: Int = 20, offset: Int = 12) {
        compose.runOnIdle {
            scroll.readerScroll.onPreScroll(Offset(0f, 6f), NestedScrollSource.UserInput)
            scroll.list.requestScrollToItem(index, offset)
        }
        frame()
        compose.runOnIdle { scope.launch { scroll.readerScroll.onPostFling(Velocity.Zero, Velocity.Zero) } }
        frame()
        compose.runOnIdle { assertFalse("reader owns scroll", scroll.pinned) }
    }
    private fun anchor(): Pair<String, Int> {
        lateinit var result: Pair<String, Int>
        compose.runOnIdle { result = scroll.list.layoutInfo.visibleItemsInfo.first().let { it.key.toString() to it.offset } }
        return result
    }
    private fun assertAnchor(expected: Pair<String, Int>) { assertEquals("stable visible content", expected, anchor()) }
    private fun assertAtEnd() {
        compose.runOnIdle {
            val info = scroll.list.layoutInfo
            val last = info.visibleItemsInfo.last()
            assertEquals("end key", "end", last.key)
            assertTrue("end remains within one physical pixel", kotlin.math.abs(last.offset + last.size - info.viewportEndOffset) <= 1)
        }
    }

    @Test fun tailStreamingKeepsReaderAnchorEveryFrame() {
        setup(); read(); val before = anchor()
        repeat(12) { compose.runOnIdle { growth.intValue += 17 }; frame(); assertAnchor(before) }
    }
    @Test fun followingTracksGrowthOnFirstFrame() {
        setup(); assertAtEnd()
        repeat(6) { compose.runOnIdle { growth.intValue += 37 }; frame(); assertAtEnd() }
    }
    @Test fun followingTracksViewportShrinkOnFirstFrame() {
        setup(); assertAtEnd()
        compose.runOnIdle { viewport.intValue = 400 }; frame(); assertAtEnd()
    }
    @Test fun shrinkingDockNearBottomDoesNotClampReader() {
        setup(); read(29); val before = anchor()
        compose.runOnIdle { dock.intValue = 20 }; frame(); assertAnchor(before)
    }
    @Test fun prependPreservesKeyRatherThanNumericIndex() {
        setup(); read(); val before = anchor()
        compose.runOnIdle { prefix.value = listOf("earlier", "older-1", "older-2") }; frame(); assertAnchor(before)
    }
    @Test fun headerFinishingKeepsParagraphBelowItFixed() {
        growth.intValue = 900
        setup(); read(31, 0)
        val before = positions.getValue("tail").first
        compose.runOnIdle { header.intValue = 0 }; frame()
        assertEquals("paragraph below finishing header", before, positions.getValue("tail").first)
    }
    @Test fun heldHeaderLetsGoOnceScrolledAway() {
        growth.intValue = 900
        setup(); read(31, 0)
        val held = positions.getValue("header").second
        compose.runOnIdle { header.intValue = 0 }; frame()
        assertEquals("held while in view", held, positions.getValue("header").second)
        read(0); read(31, 0)
        assertEquals("no gap after coming back", 0, positions.getValue("header").second)
    }
    @Test fun imageLoadingAndFailureNeverChangeFrame() {
        growth.intValue = 900
        setup(); read(30, 0)
        val initial = positions.getValue("image").second
        compose.runOnIdle { image.value = LoadedImage(ImageBitmap(80, 20), false) }; frame()
        assertEquals(initial, positions.getValue("image").second)
        compose.runOnIdle { image.value = LoadedImage(null, true) }; frame()
        assertEquals(initial, positions.getValue("image").second)
    }
    @Test fun nativeParagraphRevisitsHaveIdenticalHeights() {
        setup(); read(18); val initial = positions.filterKeys { it.startsWith("row-") }.mapValues { it.value.second }
        repeat(3) {
            read(0); read(18)
            initial.forEach { (key, height) -> positions[key]?.let { assertEquals("native size $key", height, it.second) } }
        }
    }
    @Test fun tapWithoutGrowthKeepsFollowing() {
        setup()
        compose.onNodeWithTag("viewport").performTouchInput { down(Offset(5f, 100f)); up() }
        frame()
        compose.runOnIdle { assertTrue(scroll.pinned) }
    }
    @Test fun pointerHoldDuringGrowthReleasesIntoReading() {
        setup()
        compose.onNodeWithTag("viewport").performTouchInput { down(Offset(5f, 100f)) }
        frame(); val before = anchor()
        compose.runOnIdle { growth.intValue += 150 }; frame(); assertAnchor(before)
        compose.onNodeWithTag("viewport").performTouchInput { up() }; frame()
        compose.runOnIdle { assertFalse(scroll.pinned) }; assertAnchor(before)
    }
    @Test fun tinyUserIntentWinsOverSameFrameStreaming() {
        setup()
        compose.runOnIdle {
            scroll.readerScroll.onPreScroll(Offset(0f, 6f), NestedScrollSource.UserInput)
            scroll.list.dispatchRawDelta(-6f)
            growth.intValue += 90
        }
        frame(); compose.runOnIdle { scope.launch { scroll.readerScroll.onPostFling(Velocity.Zero, Velocity.Zero) } }; frame()
        compose.runOnIdle { assertFalse(scroll.pinned) }
    }
    @Test fun restoredReaderKeepsKeyAndOffsetAfterRecreation() {
        setup(); read(16, 21); val before = anchor()
        restoration.emulateSavedInstanceStateRestore(); frame()
        assertAnchor(before)
        compose.runOnIdle { assertFalse(scroll.pinned); growth.intValue += 100 }; frame(); assertAnchor(before)
    }
    @Test fun navigationDuringStreamingFinishesAtRequestedKey() {
        setup()
        lateinit var job: kotlinx.coroutines.Job
        compose.runOnIdle { job = scope.launch { scroll.show("row-12") } }
        repeat(60) {
            compose.runOnIdle { growth.intValue += 3 }
            frame()
        }
        compose.runOnIdle {
            assertTrue("navigation completed", job.isCompleted)
            assertFalse("notes navigation remains reading", scroll.pinned)
            assertEquals("row-12", scroll.list.layoutInfo.visibleItemsInfo.first().key)
        }
    }
    @Test fun viewportWidthChangeRetainsReaderKey() {
        setup(); read(18); val before = anchor().first
        compose.runOnIdle { width.intValue = 280 }; frame()
        assertEquals(before, anchor().first)
        compose.runOnIdle { assertFalse(scroll.pinned) }
    }
    @Test fun accessibilityScrollOwnsPositionDuringStreaming() {
        setup(); compose.mainClock.autoAdvance = true
        compose.onNode(hasScrollAction()).performSemanticsAction(SemanticsActions.ScrollBy) { action -> action(0f, -600f) }
        compose.waitForIdle()
        compose.runOnIdle { assertFalse("semantic scroll enters reading", scroll.pinned) }
        val before = anchor()
        compose.runOnIdle { growth.intValue += 180 }; compose.waitForIdle(); assertAnchor(before)
    }
    @Test fun flingAwayFromBottomRemainsReadingWhenTailGrows() {
        setup(); compose.mainClock.autoAdvance = true
        compose.onNodeWithTag("viewport").performTouchInput { swipe(Offset(160f, 90f), Offset(160f, 400f), 150) }
        compose.waitForIdle()
        compose.runOnIdle { assertFalse("fling enters reading", scroll.pinned) }
        val before = anchor()
        compose.runOnIdle { growth.intValue += 180 }; compose.waitForIdle(); assertAnchor(before)
    }

    @Test fun fontScaleChangeRetainsReaderSourceKey() {
        setup(); read(18); val before = anchor().first
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        if (InstrumentationRegistry.getArguments().getString("scrollScreenshot") == "true") {
            val bitmap = instrumentation.uiAutomation.takeScreenshot()
            java.io.File(instrumentation.targetContext.cacheDir, "scroll-fixture.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
        compose.runOnIdle { fontScale.floatValue = 1.4f }; frame()
        assertEquals(before, anchor().first)
        compose.runOnIdle { assertFalse(scroll.pinned) }
    }

    @Test fun semanticIndexJumpOwnsPositionDuringStreaming() {
        setup(); compose.mainClock.autoAdvance = true
        compose.onNode(hasScrollAction()).performScrollToIndex(15)
        compose.waitForIdle()
        compose.runOnIdle { assertFalse("index jump enters reading", scroll.pinned) }
        val before = anchor()
        compose.runOnIdle { growth.intValue += 180 }; compose.waitForIdle(); assertAnchor(before)
    }

    @Test fun cancelledDragDoesNotLatchScrollingAndBlockBottom() {
        setup()
        compose.onNodeWithTag("viewport").performTouchInput {
            down(Offset(150f, 80f)); moveBy(Offset(0f, 80f)); cancel()
        }
        repeat(3) { frame() }
        compose.runOnIdle { scroll.toBottom("test_after_cancel"); growth.intValue += 50 }
        frame(); assertAtEnd()
        compose.runOnIdle { assertTrue(scroll.pinned); assertFalse(scroll.touching) }
    }

}
