package dev.relay.android.features.composer.logic

import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.ResumeSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test
import java.util.Calendar
import java.util.Locale

class FormatsAndUsageTest {
    @Test fun `formats tokens and dollars as the desktop does`() {
        assertEquals("950", formatTokens(950))
        assertEquals("12k", formatTokens(12_400))
        assertEquals("1.5k", formatTokens(1_500))
        assertEquals("2k", formatTokens(2_000))
        assertEquals("1.2M", formatTokens(1_200_000))
        assertEquals("$3", formatDollars(3.0))
        assertEquals("$2.50", formatDollars(2.5))
        assertEquals("$1,235", formatDollars(1234.6))
        assertEquals("−$4.20", formatDollars(-4.2))
        assertEquals("<$0.01", formatCost(0.004))
    }

    @Test fun `offers this evening only before five`() {
        fun at(hour: Int) = Calendar.getInstance().apply { set(2026, 9, 14, hour, 0, 0) }.timeInMillis
        assertEquals("This evening", sendLaterPresets(at(10))[3].label)
        assertEquals(listOf("In 30 minutes", "In 1 hour", "In 3 hours", "Tomorrow morning"), sendLaterPresets(at(18)).map { it.label })
        val now = at(10)
        assertEquals(true, wakeLabel(sendLaterPresets(at(18)).last().at, at(18), Locale.US).startsWith("tomorrow "))
        assertEquals(false, wakeLabel(now + 60_000, now, Locale.US).startsWith("tomorrow"))
    }

    @Test fun `titles a thread from its prompt`() {
        assertEquals("Fix the login", promptTitle("@claude Fix the login"))
        assertEquals("Screenshot", promptTitle("  "))
        assertEquals("first line", promptTitle("Pasted text #1:\n\n```\nfirst line\nsecond\n```"))
        assertEquals(65, promptTitle("x".repeat(100)).length)
    }

    @Test fun `retries an unchanged failed draft with its id`() {
        val s = ResumeSettings("codex", ModelChoice(""), null, "full-access", "default")
        val images = emptyList<String>()
        val first = composeAttempt(ComposeDraft("a:c", "hi", s, images), null, null, null) { "1" }
        assertSame(first, composeAttempt(ComposeDraft("a:c", "hi", s, images), "queue", null, first) { "2" })
        assertNotSame(first, composeAttempt(ComposeDraft("a:c", "hi!", s, images), null, null, first) { "2" })
    }

    @Test fun `paces a usage window`() {
        val hour = 3_600_000L
        val period = 5 * hour
        val now = 1_000_000_000_000L
        // Two hours in, 70% used: on course for 175%, out in under an hour.
        val behind = presentWindow(UsageWindow("session", 70.0, now + 3 * hour, period), now)
        assertEquals("hot", behind.pace)
        assertEquals(30, behind.leftPercent)
        assertEquals("Out in ~52m", behind.limitLabel)
        assertEquals("Resets in 3h", behind.resetLabel)
        val ahead = presentWindow(UsageWindow("session", 10.0, now + 3 * hour, period), now)
        assertEquals("ok", ahead.pace)
        assertEquals("30% ahead", paceGap(ahead))
        assertEquals("Not started", presentWindow(UsageWindow("session", 0.0, null, period), now).resetLabel)
        assertEquals("Limit reached", presentWindow(UsageWindow("weekly", 100.0, now + hour, 7 * 24 * hour), now).limitLabel)
        assertEquals("62,500 credits", creditsLabel(UsageCredits(62_500.0, false)))
        assertEquals("~3–8 messages", creditsReach(UsageCredits(1.0, false, listOf(3.0, 8.0))))
    }
}
