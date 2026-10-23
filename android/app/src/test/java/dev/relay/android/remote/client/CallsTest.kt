package dev.relay.android.remote.client

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CallsTest {
    @Test fun `a request refused locally leaves no pending call or timeout`() = runTest {
        val calls = Calls(backgroundScope) { "computer" }
        val refused = calls.open(1000) { throw IllegalArgumentException("too large") }
        assertEquals("too large", runCatching { refused.await() }.exceptionOrNull()?.message)
        assertFalse(calls.waiting)
    }
}
