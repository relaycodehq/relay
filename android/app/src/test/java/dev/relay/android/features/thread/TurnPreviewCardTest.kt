package dev.relay.android.features.thread

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnPreviewCardTest {
    // The computer's own addresses mean the phone itself; only the computer can open them.
    @Test fun opensOnlyPagesOffTheComputer() {
        for (url in listOf(
            "http://localhost:5173/", "http://127.0.0.1:3000/a", "http://[::1]:8080", "http://0.0.0.0:4000",
            "http://app.localhost/", "file:///tmp/index.html", "about:blank", "not a url",
        )) assertFalse(url, opensOnPhone(url))
        for (url in listOf("https://relaycode.io/compare/", "http://192.168.0.12:3000/", "https://example.com"))
            assertTrue(url, opensOnPhone(url))
    }

    @Test fun dropsTheSchemeLikeTheDesktop() {
        assertEquals("localhost:5173/admin", shortUrl("http://localhost:5173/admin"))
        assertEquals("relaycode.io/", shortUrl("https://relaycode.io/"))
        assertEquals("file:///tmp/a.html", shortUrl("file:///tmp/a.html"))
    }
}
