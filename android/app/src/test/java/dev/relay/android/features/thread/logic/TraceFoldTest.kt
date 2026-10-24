package dev.relay.android.features.thread.logic

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TraceFoldTest {
    @Test fun endedWhileReadBackStaysOpenAtTheBottom() {
        val fold = TraceFold()
        assertTrue(fold.open(live = true, savedCopy = false, readingBack = true))
        assertTrue(fold.open(live = false, savedCopy = false, readingBack = true))
        assertTrue(fold.open(live = false, savedCopy = false, readingBack = false))
    }

    @Test fun endedWhileFollowingFolds() {
        val fold = TraceFold()
        fold.open(live = true, savedCopy = false, readingBack = false)
        assertFalse(fold.open(live = false, savedCopy = false, readingBack = false))
    }

    @Test fun savedCopyRunningOpensFoldedAndStaysSoOnceFetchedEnded() {
        val fold = TraceFold()
        assertFalse(fold.open(live = true, savedCopy = true, readingBack = false))
        assertFalse(fold.open(live = false, savedCopy = false, readingBack = true))
    }

    @Test fun savedCopyStillRunningOpensOnceFetched() {
        val fold = TraceFold()
        fold.open(live = true, savedCopy = true, readingBack = true)
        assertTrue(fold.open(live = true, savedCopy = false, readingBack = true))
    }
}
