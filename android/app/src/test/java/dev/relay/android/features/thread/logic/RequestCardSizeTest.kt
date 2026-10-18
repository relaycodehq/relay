package dev.relay.android.features.thread.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestCardSizeTest {
    @Test fun withoutAKeyboardItTakesAtMostSixtyPercent() {
        assertEquals(480f, requestCardMaxHeightDp(800f, 0f), 0.01f)
    }

    @Test fun anOpenKeyboardShrinksItSoTheComposerStaysOnScreen() {
        val withKeyboard = requestCardMaxHeightDp(800f, 360f)
        assertTrue(withKeyboard < 480f)
        // Card + bars + composer + keyboard fit the screen.
        assertTrue(withKeyboard + 234f + 360f <= 800f)
    }

    @Test fun neverSmallerThanTheQuestionNeeds() {
        assertEquals(200f, requestCardMaxHeightDp(600f, 400f), 0.01f)
    }

    @Test fun aShortWindowDoesNotCrashAndStaysWithinSixtyPercent() {
        assertEquals(180f, requestCardMaxHeightDp(300f, 0f), 0.01f)
    }
}
