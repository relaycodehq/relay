package dev.relay.android.features.images

import org.junit.Assert.assertEquals
import org.junit.Test

class BitmapSizeTest {
    @Test fun `keeps ordinary pictures and big screenshots whole`() {
        assertEquals(1, sampleSizeFor(1600, 1200))
        // A 6K display's screenshot, 78 MiB decoded, still draws.
        assertEquals(1, sampleSizeFor(6016, 3384))
    }

    @Test fun `shrinks a picture Android would refuse to draw`() {
        // A retina full-page screenshot: 110 MiB whole, past the 100 MiB Android draws; at half each side, 27 MiB.
        assertEquals(2, sampleSizeFor(1440, 20_000))
        // 381 MiB whole; a quarter each side is 24 MiB.
        assertEquals(4, sampleSizeFor(10_000, 10_000))
    }
}
