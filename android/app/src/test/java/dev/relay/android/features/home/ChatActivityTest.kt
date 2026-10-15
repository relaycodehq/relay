package dev.relay.android.features.home

import dev.relay.android.remote.model.ChatPending
import dev.relay.android.remote.model.RemoteChatSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Locale

fun chat(id: String = "c", updated: Long = 5_000, created: Long = 1_000, edit: RemoteChatSummary.() -> RemoteChatSummary = { this }) =
    RemoteChatSummary(id = id, projectId = "p", title = "Thread $id", scope = "project", updated = updated, created = created).edit()

class ChatActivityTest {
    private val prague = ZoneId.of("Europe/Prague")
    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int = 0) = LocalDateTime.of(y, mo, d, h, mi).atZone(prague).toInstant().toEpochMilli()
    private fun local(ms: Long) = Instant.ofEpochMilli(ms).atZone(prague)

    @Test
    fun settledMeansSettledAfterTheLastActivityUnlessWaitingOrSettledMidAnswer() {
        assertTrue(chatSettled(chat { copy(settledAt = 6_000) }))
        assertFalse(chatSettled(chat { copy(settledAt = 4_000) }))
        assertFalse(chatSettled(chat { copy(settledAt = 6_000, waiting = true) }))
        assertFalse(chatSettled(chat { copy(settledAt = 6_000, running = true) }))
        assertTrue(chatSettled(chat { copy(settledAt = 4_000, running = true, settleWhenDone = 4_000) }))
    }

    @Test
    fun sectionsSplitAndKeepTheLatestFifteenSettledNewestSettleFirst() {
        val settled = (1..20).map { i -> chat("s$i", updated = 100) { copy(settledAt = 100L + i) } }
        val snoozed = chat("z") { copy(snoozedUntil = 10_000) }
        val woke = chat("w") { copy(snoozedUntil = 900) }
        val s = chatActivitySections(settled + snoozed + woke, now = 1_000)
        assertEquals(listOf("w"), s.active.map { it.id })
        assertEquals(listOf("z"), s.snoozed.map { it.id })
        assertEquals(15, s.settled.size)
        assertEquals("s20", s.settled.first().id)
    }

    @Test
    fun inputBlocksOnlyWhenTheTurnStoppedOrTheRequestBlocks() {
        assertTrue(inputBlocksThread(chat { copy(waiting = true) }))
        assertFalse(inputBlocksThread(chat { copy(waiting = true, running = true, asking = true) }))
        assertTrue(inputBlocksThread(chat { copy(waiting = true, running = true, asking = true, blocked = true) }))
        assertTrue(inputBlocksThread(chat { copy(waiting = true, running = true) }))
    }

    @Test
    fun agentsSinceIsTheOldestBackgroundAgent() {
        val pending = listOf(
            ChatPending("task", "a", since = 50, agent = true),
            ChatPending("task", "b", since = 20),
            ChatPending("task", "c", since = 30, agent = true),
            ChatPending("wakeup", "d", at = 10),
        )
        assertEquals(30L, agentsSince(pending))
        assertEquals(null, agentsSince(null))
    }

    @Test
    fun presetsDropTheEveningPastFiveAndNextWeekIsAMonday() {
        val morning = at(2026, 9, 22, 10)
        val presets = snoozePresets(morning, prague)
        assertEquals(listOf("quarter", "hour", "three-hours", "evening", "tomorrow", "next-week"), presets.map { it.id })
        assertEquals(18, local(presets[3].until).hour)
        assertEquals(DayOfWeek.MONDAY, local(presets.last().until).dayOfWeek)
        assertFalse(snoozePresets(at(2026, 9, 22, 19), prague).any { it.id == "evening" })
    }

    @Test
    fun aSundaysNextWeekIsPastTomorrow() {
        val sunday = snoozePresets(at(2026, 10, 11, 10), prague).associate { it.id to local(it.until) }
        assertEquals(12, sunday.getValue("tomorrow").dayOfMonth)
        assertEquals(19, sunday.getValue("next-week").dayOfMonth)
        // A Monday waits for the next one.
        assertEquals(19, local(snoozePresets(at(2026, 10, 12, 10), prague).last().until).dayOfMonth)
    }

    @Test
    fun wakeLabelCountsCalendarDaysAcrossDst() {
        val fallBack = at(2026, 10, 25, 10)
        assertFalse(wakeLabel(at(2026, 10, 25, 23, 30), fallBack, prague, Locale.UK).startsWith("tomorrow"))
        assertTrue(wakeLabel(at(2027, 3, 29, 0, 30), at(2027, 3, 28, 10), prague, Locale.UK).startsWith("tomorrow "))
        assertEquals("Mon 09:00", wakeLabel(at(2026, 10, 19, 9), at(2026, 10, 14, 10), prague, Locale.UK))
        assertTrue(wakeLabel(at(2026, 10, 30, 9), at(2026, 10, 14, 10), prague, Locale.US).startsWith("Oct 30, 9:00"))
    }

    @Test
    fun labelsForElapsedAndAge() {
        assertEquals("0s", elapsedLabel(10_000, 5_000))
        assertEquals("59s", elapsedLabel(0, 59_999))
        assertEquals("4m 12s", elapsedLabel(0, 252_000))
        assertEquals("1h 3m", elapsedLabel(0, 3_780_000))
        assertEquals("now", shortAge(0, 59_000))
        assertEquals("4m", shortAge(0, 240_000))
        assertEquals("3h", shortAge(0, 3 * 3_600_000L))
        assertEquals("2d", shortAge(0, 2 * 86_400_000L))
        assertEquals("5w", shortAge(0, 35 * 86_400_000L))
    }

    @Test
    fun readUpToTakesTheFurthestOfFirstLookDeviceAndDesktop() {
        val c = chat { copy(seenAt = 4_000) }
        assertTrue(movedSinceSeen(c, 3_000, emptyMap()))
        assertFalse(movedSinceSeen(c, 3_000, mapOf("c" to 5_000)))
        assertFalse(movedSinceSeen(c, 6_000, emptyMap()))
    }

    @Test
    fun draftsGoFirstEvenFromSettledButSnoozedStayOnTheirShelf() {
        val a = chat("a", updated = 900)
        val b = chat("b", updated = 800) { copy(settledAt = 850) }
        val c = chat("c", updated = 700) { copy(snoozedUntil = 5_000) }
        val d = chat("d", updated = 600)
        val all = listOf(a, b, c, d)
        val s = draftsFirst(chatActivitySections(all, 1_000), all, setOf("b", "c", "d"))
        assertEquals(listOf("b", "d", "a"), s.active.map { it.id })
        assertEquals(listOf("c"), s.snoozed.map { it.id })
        assertTrue(s.settled.isEmpty())
    }

    @Test
    fun aSentDraftKeepsItsPlaceUntilSettledAgain() {
        val a = chat("a", updated = 900)
        val b = chat("b", updated = 500) { copy(settledAt = 600) }
        val all = listOf(a, b)
        val raised = mapOf("b" to DraftRaise(at = 950, sent = true))
        val s = draftsFirst(chatActivitySections(all, 1_000), all, emptySet(), raised)
        assertEquals(listOf("b", "a"), s.active.map { it.id })
        assertTrue(s.settled.isEmpty())
        val cleared = draftsFirst(chatActivitySections(all, 1_000), all, emptySet(), mapOf("b" to DraftRaise(950, sent = false)))
        assertEquals(listOf("a"), cleared.active.map { it.id })
    }
}
