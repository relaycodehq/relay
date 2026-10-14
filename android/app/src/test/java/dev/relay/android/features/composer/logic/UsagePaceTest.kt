package dev.relay.android.features.composer.logic

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.TimeZone

// The "weekly pace over working hours" cases from shared/usage-history.test.ts.
class UsagePaceTest {
    private val week = 7 * 24 * 60 * 60 * 1000L
    private val zone = ZoneId.of("Europe/Prague")
    private lateinit var saved: TimeZone
    private val nineToFive = List(24) { h -> if (h in 9..16) 1.0 else 0.0 }

    @Before fun pinZone() { saved = TimeZone.getDefault(); TimeZone.setDefault(TimeZone.getTimeZone(zone)) }
    @After fun restoreZone() = TimeZone.setDefault(saved)

    // Local times, since working hours are learned per local hour of the day.
    private fun at(day: Int, hour: Int, minute: Int = 0) =
        LocalDateTime.of(2026, 9, day, hour, minute).atZone(zone).toInstant().toEpochMilli()

    private fun weekly(used: Double) = UsageWindow("weekly", used, at(21, 0) + week, week)

    @Test fun holdsThePaceMarkStillOvernight() {
        val evening = presentWindow(weekly(10.0), at(21, 20), nineToFive)
        val morning = presentWindow(weekly(10.0), at(22, 8), nineToFive)
        assertEquals(48.0 / 56 * 100, evening.paceLeftPercent!!, 1e-5)
        assertEquals(evening.paceLeftPercent!!, morning.paceLeftPercent!!, 1e-5)
        // Wall-clock pacing slides it on through the night.
        assertTrue(presentWindow(weekly(10.0), at(22, 8)).paceLeftPercent!! < presentWindow(weekly(10.0), at(21, 20)).paceLeftPercent!!)
    }

    @Test fun keepsARunOutAmberWhileOnlyALittlePastTheMark() {
        // 2 hours in: the mark is at ~96% left and 8% is used.
        val meter = presentWindow(weekly(8.0), at(21, 11), nineToFive)
        assertEquals(92, meter.leftPercent)
        assertEquals("warn", meter.pace)
        assertTrue(meter.limitLabel!!, meter.limitLabel!!.startsWith("Out in ~"))
        assertEquals("hot", presentWindow(weekly(20.0), at(21, 11), nineToFive).pace)
    }

    @Test fun aSessionKeepsTheWallClock() {
        val session = UsageWindow("session", 50.0, at(21, 12), 5 * 60 * 60 * 1000L)
        assertEquals(presentWindow(session, at(21, 10)), presentWindow(session, at(21, 10), nineToFive))
    }

    @Test fun nextHourFollowsHalfHourZones() {
        val india = ZoneId.of("Asia/Kolkata")
        val t = LocalDateTime.of(2026, 9, 21, 10, 40).atZone(india).toInstant().toEpochMilli()
        val next = LocalDateTime.of(2026, 9, 21, 11, 0).atZone(india).toInstant().toEpochMilli()
        assertEquals(next, nextHour(t, india))
        assertEquals(0.5, activeWeight(nineToFive, at(21, 8, 30), at(21, 9, 30)), 1e-9)
    }
}
