package dev.relay.android.features.renders

import org.junit.Assert.*
import org.junit.Test

class SettledSizesTest {
    @Test fun recentMeasurementsSurviveAndOldestIsEvicted() {
        val cache = SettledSizes<String>(2)
        cache["a"] = 100
        cache["b"] = 200
        assertEquals(100, cache["a"])
        cache["c"] = 300
        assertNull(cache["b"])
        assertEquals(100, cache["a"])
        assertEquals(300, cache["c"])
        assertEquals(2, cache.size)
    }

    @Test fun invalidMeasurementsDoNotReplaceSettledSizes() {
        val cache = SettledSizes<String>()
        cache["a"] = 100
        cache["a"] = 0
        cache["b"] = -20
        assertEquals(100, cache["a"])
        assertNull(cache["b"])
    }
}
