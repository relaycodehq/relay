package dev.relay.android.features.thread.scroll

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class ReadingViewportTest {
    @Test fun finishingStatusAndClearingDraftCannotExpandANearEndReadersViewport() {
        val viewport = ReadingViewport()
        assertEquals(900, viewport.height(1080, 900, holding = false, belowEnd = { 0 }))
        assertEquals(900, viewport.height(1080, 900, holding = true, belowEnd = { 0 }))
        assertEquals(900, viewport.height(1080, 1020, holding = true, belowEnd = { 0 }))
        assertEquals(900, viewport.height(1080, 1200, holding = true, belowEnd = { 0 }))
        assertEquals(1200, viewport.height(1080, 1200, holding = false, belowEnd = { 0 }))
    }

    @Test fun enoughOffscreenContentAllowsReclaimingSpaceWithoutClampingTheAnchor() {
        val viewport = ReadingViewport()
        viewport.height(1080, 900, holding = true, belowEnd = { 0 })
        assertEquals(1050, viewport.height(1080, 1050, holding = true, belowEnd = { 150 }))
        assertEquals(1050, viewport.height(1080, 1150, holding = true, belowEnd = { 99 }))
        assertEquals(1150, viewport.height(1080, 1150, holding = true, belowEnd = { 100 }))
    }

    @Test fun anUnlaidOutLastRowMeansThereIsRoomBelowTheReader() {
        val viewport = ReadingViewport()
        viewport.height(1080, 900, holding = true, belowEnd = { 0 })
        assertEquals(1200, viewport.height(1080, 1200, holding = true, belowEnd = { null }))
    }

    @Test fun keyboardAndDockGrowthCanAlwaysShrinkTheViewport() {
        val viewport = ReadingViewport()
        viewport.height(1080, 1200, holding = true, belowEnd = { 0 })
        assertEquals(650, viewport.height(1080, 650, holding = true, belowEnd = { 0 }))
        assertEquals(650, viewport.height(1080, 1200, holding = true, belowEnd = { 0 }))
        assertEquals(0, viewport.height(1080, 0, holding = true, belowEnd = { 0 }))
    }

    @Test fun changingWidthDiscardsMeasurementsFromThePreviousTextWrapping() {
        val viewport = ReadingViewport()
        viewport.height(1080, 900, holding = true, belowEnd = { 0 })
        assertEquals(1200, viewport.height(1800, 1200, holding = true, belowEnd = { 0 }))
        assertEquals(1200, viewport.height(1800, 1400, holding = true, belowEnd = { 0 }))
    }

    @Test fun repeatedDockTransitionsCannotAccumulateOnePixelOfAnchorClamping() {
        val random = Random(8102)
        val viewport = ReadingViewport()
        var previous = viewport.height(1080, 900, holding = true, belowEnd = { 0 })
        repeat(10_000) {
            val available = random.nextInt(0, 2000)
            val below = random.nextInt(0, 600)
            val next = viewport.height(1080, available, holding = true, belowEnd = { below })
            assertTrue("viewport $previous -> $next with only $below px below", next - previous <= below)
            assertTrue(next in 0..available)
            previous = next
        }
    }

    @Test fun stableAndShrinkingViewportsDoNotObserveListGeometry() {
        val viewport = ReadingViewport()
        val unexpected = { error("Stable viewport subscribed to scroll-frame geometry") }
        viewport.height(1080, 900, holding = true, belowEnd = unexpected)
        repeat(80) { viewport.height(1080, 900, holding = true, belowEnd = unexpected) }
        viewport.height(1080, 700, holding = true, belowEnd = unexpected)
        viewport.height(1800, 1200, holding = true, belowEnd = unexpected)
        viewport.height(1800, 1400, holding = false, belowEnd = unexpected)
    }

    @Test fun onlyReservedSpaceReclamationObservesGeometryAndCanRetryLater() {
        val viewport = ReadingViewport()
        var reads = 0
        viewport.height(1080, 900, holding = true) { error("Initial measurement needs no geometry") }
        assertEquals(900, viewport.height(1080, 1200, holding = true) { reads++; 0 })
        assertEquals(1, reads)
        assertEquals(1200, viewport.height(1080, 1200, holding = true) { reads++; 300 })
        assertEquals(2, reads)
        viewport.height(1080, 1200, holding = true) { error("Reclaimed viewport needs no dependency") }
    }

}
