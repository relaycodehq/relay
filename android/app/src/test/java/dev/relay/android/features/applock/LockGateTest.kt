package dev.relay.android.features.applock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/** iOS mirrors these in RelayKit's AppLockTests. */
class LockGateTest {
    private val pin = StoredPin("AAECAwQFBgcICQoLDA0ODw==", "Pj0kIvAPLMHRutBFgZv7g2ARfVnFiANcQpTzQDrAl6U=", 100_000)
    private fun on(after: LockAfter = LockAfter.Immediately) = LockSettings(pin = pin, after = after)

    @Test fun pinHashMatchesTheVectorIosChecksToo() {
        val salt = Base64.getDecoder().decode("AAECAwQFBgcICQoLDA0ODw==")
        assertEquals(pin, StoredPin.of("123456", salt))
        assertTrue(pin.matches("123456"))
        assertFalse(pin.matches("123457"))
    }

    @Test fun aColdStartIsLockedOnlyWithALock() {
        assertTrue(LockGate(on = true).locked)
        assertFalse(LockGate(on = false).locked)
    }

    @Test fun rightAwayLocksOnLeaving() {
        val gate = LockGate(on = false)
        gate.left(on(), now = 1_000)
        assertTrue(gate.locked)
    }

    @Test fun aTimedLockWaitsForTheTimeAway() {
        val gate = LockGate(on = false)
        gate.left(on(LockAfter.OneMinute), now = 0)
        assertFalse(gate.locked)
        gate.back(on(LockAfter.OneMinute), now = 59_999)
        assertFalse(gate.locked)
        gate.left(on(LockAfter.OneMinute), now = 100_000)
        gate.back(on(LockAfter.OneMinute), now = 160_000)
        assertTrue(gate.locked)
    }

    @Test fun aTripRelaySentTheReaderOnDoesntLockUnlessItRunsLong() {
        val gate = LockGate(on = false)
        gate.ownTrip(now = 0)
        gate.left(on(), now = 10)
        gate.back(on(), now = 30_000)
        assertFalse(gate.locked)
        // Only that one trip: the next leave locks again.
        gate.left(on(), now = 40_000)
        assertTrue(gate.locked)

        val long = LockGate(on = false)
        long.ownTrip(now = 0)
        long.left(on(), now = 10)
        long.back(on(), now = LockGate.OWN_TRIP_MS)
        assertTrue(long.locked)
    }

    @Test fun noLockNoLocking() {
        val gate = LockGate(on = false)
        gate.left(LockSettings(), now = 0)
        gate.back(LockSettings(), now = 10_000_000)
        assertFalse(gate.locked)
    }

    @Test fun wrongPinsCountAndThenMakeYouWait() {
        var settings = on()
        repeat(4) {
            val (next, result) = LockGate.attempt(settings, matches = false, now = 0)
            settings = next
            assertEquals(Attempt.Wrong(it + 1, 0), result)
        }
        val (fifth, result) = LockGate.attempt(settings, matches = false, now = 1_000)
        assertEquals(Attempt.Wrong(5, 30_000), result)
        assertEquals(31_000, fifth.waitUntil)
        // Even the right PIN waits.
        assertEquals(Attempt.Waiting(20_000), LockGate.attempt(fifth, matches = true, now = 11_000).second)
        val (after, ok) = LockGate.attempt(fifth, matches = true, now = 31_000)
        assertEquals(Attempt.Unlocked, ok)
        assertEquals(0, after.failures)
        assertEquals(0, after.waitUntil)
    }

    @Test fun waitsGrow() {
        assertEquals(listOf(0L, 30_000L, 60_000L, 300_000L, 900_000L, 3_600_000L, 3_600_000L), (4..10).map(LockWords::waitAfter))
    }

    @Test fun words() {
        assertEquals("Too many tries. Try again in 30s", LockWords.waitLine(30_000))
        assertEquals("Too many tries. Try again in 1s", LockWords.waitLine(1))
        assertEquals("Too many tries. Try again in 2 min", LockWords.waitLine(61_000))
        assertEquals("Wrong PIN", LockWords.wrongLine(1))
        assertEquals("Wrong PIN. One more and Relay makes you wait.", LockWords.wrongLine(4))
    }
}
