package dev.relay.android.features.images

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LightboxTransformTest {
    private val image = LightboxTransform().apply { resize(0.5f, 400f, 800f) }

    @Test fun pinchingOffCentreKeepsTheImageUnderTheFingersWithoutCountingPanTwice() {
        image.pinch(2f, Offset(-20f, 30f), Offset(300f, 400f))
        assertEquals(2f, image.scale)
        assertEquals(Offset(-120f, 30f), image.offset)
    }

    @Test fun freshOutwardSwipesPageAtEitherHorizontalEdgeButInwardSwipesPan() {
        image.pinch(2f, Offset.Zero, Offset(200f, 400f))
        assertTrue(image.canPan(Offset(30f, 0f)))
        assertTrue(image.canPan(Offset(-30f, 0f)))

        image.pan(Offset(1_000f, 0f))
        assertEquals(200f, image.offset.x)
        assertFalse(image.canPan(Offset(30f, 0f)))
        assertTrue(image.canPan(Offset(-30f, 0f)))

        image.pan(Offset(-2_000f, 0f))
        assertEquals(-200f, image.offset.x)
        assertFalse(image.canPan(Offset(-30f, 0f)))
        assertTrue(image.canPan(Offset(30f, 0f)))
        assertTrue(image.canPan(Offset(-2f, 30f)))
    }

    @Test fun aZoomedImageNarrowerThanTheViewportStillAllowsHorizontalPaging() {
        image.resize(0.1f, 400f, 800f)
        image.pinch(2f, Offset.Zero, Offset(200f, 400f))
        assertTrue(image.zoomed)
        assertFalse(image.canPan(Offset(30f, 0f)))
        assertFalse(image.canPan(Offset(-30f, 0f)))
        assertTrue(image.canPan(Offset(0f, 30f)))
    }

    @Test fun shrinkingTheImageClampsItsPanAndAllowsPagingAtFit() {
        image.pinch(3f, Offset.Zero, Offset(200f, 400f))
        image.pan(Offset(1_000f, 2_000f))
        image.pinch(0.5f, Offset.Zero, Offset(200f, 400f))
        assertEquals(Offset(100f, 200f), image.offset)
        image.pinch(2f / 3, Offset.Zero, Offset(200f, 400f))
        assertEquals(1f, image.scale)
        assertEquals(Offset.Zero, image.offset)
        assertFalse(image.canPan(Offset(30f, 0f)))
    }

    @Test fun unfoldingClampsTheImageToItsNewBoundsAndLeavingAPageResetsIt() {
        image.pinch(3f, Offset.Zero, Offset(200f, 400f))
        image.pan(Offset(1_000f, 2_000f))
        image.resize(0.5f, 800f, 400f)
        assertEquals(Offset(0f, 400f), image.offset)
        image.reset()
        assertEquals(1f, image.scale)
        assertEquals(Offset.Zero, image.offset)
        assertFalse(image.zoomed)
    }
}
