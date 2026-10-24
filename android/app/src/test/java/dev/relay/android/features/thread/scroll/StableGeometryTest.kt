package dev.relay.android.features.thread.scroll

import org.junit.Assert.assertEquals
import org.junit.Test

class StableGeometryTest {
    @Test fun holdsDisappearingChromeAcrossGrowthAndReleasesWhenFollowing() {
        val size = StableGeometryState()
        assertEquals(120, size.height(400, 120, false))
        assertEquals(120, size.height(400, 30, true))
        assertEquals(160, size.height(400, 160, true))
        assertEquals(160, size.height(400, 0, true))
        assertEquals(30, size.height(400, 30, false))
        assertEquals(30, size.height(400, 10, true))
    }

    @Test fun forgottenReserveRemeasuresNaturallyWhileReading() {
        val size = StableGeometryState()
        size.height(400, 2400, false)
        assertEquals(2400, size.height(400, 40, true))
        size.forget()
        assertEquals(40, size.height(400, 40, true))
    }

    @Test fun widthChangeStartsNewMeasurementRegime() {
        val size = StableGeometryState()
        size.height(400, 300, false)
        assertEquals(90, size.height(800, 90, true))
        assertEquals(90, size.height(800, 20, true))
    }
}
