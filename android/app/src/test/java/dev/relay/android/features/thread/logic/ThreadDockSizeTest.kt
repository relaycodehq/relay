package dev.relay.android.features.thread.logic

import org.junit.Assert.assertEquals
import org.junit.Test

class ThreadDockSizeTest {
    @Test fun finishingAgentsAndClearingADraftDoNotReclaimTheReadersViewport() {
        val dock = ThreadDockSize()
        assertEquals(391, dock.height(1080, 391, 2200, pinned = true))
        assertEquals(391, dock.height(1080, 391, 2200, pinned = false))
        assertEquals(391, dock.height(1080, 265, 2200, pinned = false))
        assertEquals(500, dock.height(1080, 500, 2200, pinned = false))
        assertEquals(500, dock.height(1080, 265, 2200, pinned = false))
        assertEquals(265, dock.height(1080, 265, 2200, pinned = true))
    }

    @Test fun windowChangesCannotKeepAnOversizedDock() {
        val dock = ThreadDockSize()
        dock.height(1080, 500, 2200, pinned = true)
        assertEquals(300, dock.height(1080, 200, 300, pinned = false))
        assertEquals(200, dock.height(1800, 200, 1200, pinned = false))
    }
}
