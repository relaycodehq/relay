package dev.relay.android.features.home

import dev.relay.android.remote.model.ChatPending
import dev.relay.android.remote.model.RemoteChatSummary
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

// Port of shared/chat-activity.ts, thread-state.ts and waiting.ts's agentsSince: the parts
// the phone's Activity reads.

enum class ActivitySection { Active, Snoozed, Settled }

data class ActivitySections(
    val active: List<RemoteChatSummary>,
    val snoozed: List<RemoteChatSummary>,
    val settled: List<RemoteChatSummary>,
)

fun chatSettled(chat: RemoteChatSummary): Boolean {
    if (chat.waiting == true || chat.settledAt == null) return false
    // Settled mid-answer: the answer it waits for moves `updated` past it.
    if (chat.settleWhenDone != null) return true
    return chat.running != true && chat.settledAt >= chat.updated
}

private fun chatSnoozed(chat: RemoteChatSummary, now: Long) = chat.snoozedUntil != null && chat.snoozedUntil > now

fun chatActivitySection(chat: RemoteChatSummary, now: Long): ActivitySection = when {
    chatSettled(chat) -> ActivitySection.Settled
    chatSnoozed(chat, now) -> ActivitySection.Snoozed
    else -> ActivitySection.Active
}

/** Only the latest settled threads stay in Activity; Projects lists them all. */
private const val SETTLED_SHELF_SIZE = 15

fun chatActivitySections(chats: List<RemoteChatSummary>, now: Long): ActivitySections {
    val by = chats.groupBy { chatActivitySection(it, now) }
    return ActivitySections(
        active = by[ActivitySection.Active].orEmpty(),
        snoozed = by[ActivitySection.Snoozed].orEmpty(),
        // Latest settled first: one settled just now stays there to undo.
        settled = by[ActivitySection.Settled].orEmpty().sortedByDescending { it.settledAt }.take(SETTLED_SHELF_SIZE),
    )
}

/** Only blocking requests or questions left after the turn stops end an orchestration wait. */
fun inputBlocksThread(chat: RemoteChatSummary) =
    chat.waiting == true && (chat.running != true || chat.asking != true || chat.blocked == true)

/** When the oldest background agent still going started, if any. */
fun agentsSince(pending: List<ChatPending>?): Long? =
    pending.orEmpty().filter { it.kind == "task" && it.agent == true }.mapNotNull { it.since }.minOrNull()

data class SnoozePreset(val id: String, val label: String, val until: Long)

private const val HOUR_MS = 3_600_000L

/** Local `hour`:00 `days` calendar days after `from`; calendar days keep the hour across DST. */
private fun dayAt(from: ZonedDateTime, days: Long, hour: Int): Long =
    from.toLocalDate().plusDays(days).atTime(hour, 0).atZone(from.zone).toInstant().toEpochMilli()

/** A Monday waits for the next one, and so does a Sunday, whose coming Monday is already Tomorrow. */
private fun daysToMonday(date: ZonedDateTime): Long {
    val jsDay = date.dayOfWeek.value % 7 // 0 = Sunday, as JS's getDay
    return if (jsDay == 0) 8 else (7 - ((jsDay + 6) % 7)).toLong()
}

fun snoozePresets(now: Long, zone: ZoneId = ZoneId.systemDefault()): List<SnoozePreset> {
    val at = Instant.ofEpochMilli(now).atZone(zone)
    return listOfNotNull(
        SnoozePreset("quarter", "15 minutes", now + HOUR_MS / 4),
        SnoozePreset("hour", "1 hour", now + HOUR_MS),
        SnoozePreset("three-hours", "3 hours", now + 3 * HOUR_MS),
        // Past five the evening is too close to be worth a choice of its own.
        if (at.hour < 17) SnoozePreset("evening", "This evening", dayAt(at, 0, 18)) else null,
        SnoozePreset("tomorrow", "Tomorrow", dayAt(at, 1, 9)),
        SnoozePreset("next-week", "Next week", dayAt(at, daysToMonday(at), 9)),
    )
}

/** How far a thread has been read: here (`seen`), anywhere (`seenAt`), or before this device first looked. */
fun readUpTo(chat: RemoteChatSummary, since: Long, seen: Map<String, Long>): Long =
    maxOf(since, seen[chat.id] ?: 0L, chat.seenAt ?: 0L)

fun movedSinceSeen(chat: RemoteChatSummary, since: Long, seen: Map<String, Long>) =
    chat.updated > readUpTo(chat, since, seen)

private fun calendarDays(from: LocalDate, to: LocalDate) = ChronoUnit.DAYS.between(from, to)

/** "17:30", "tomorrow 9:00", "Mon 9:00", "Oct 3, 9:00". */
fun wakeLabel(until: Long, now: Long, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
    val wake = Instant.ofEpochMilli(until).atZone(zone)
    val ahead = calendarDays(Instant.ofEpochMilli(now).atZone(zone).toLocalDate(), wake.toLocalDate())
    val day = when {
        ahead <= 0 -> ""
        ahead == 1L -> "tomorrow "
        ahead < 7 -> DateTimeFormatter.ofPattern("EEE", locale).format(wake) + " "
        else -> DateTimeFormatter.ofPattern("MMM d", locale).format(wake) + ", "
    }
    return day + DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(wake)
}

/** How long a running turn has gone, by the second: "26s", "4m 12s", "1h 3m". */
fun elapsedLabel(since: Long, now: Long): String {
    val seconds = maxOf(0L, (now - since) / 1000)
    return when {
        seconds < 60 -> "${seconds}s"
        seconds < 3600 -> "${seconds / 60}m ${seconds % 60}s"
        else -> "${seconds / 3600}h ${(seconds / 60) % 60}m"
    }
}

/** Compact age for rows: "now", "4m", "3h", "2d", "5w". */
fun shortAge(then: Long, now: Long): String {
    val minutes = maxOf(0L, (now - then) / 60_000)
    if (minutes < 1) return "now"
    if (minutes < 60) return "${minutes}m"
    val hours = minutes / 60
    if (hours < 24) return "${hours}h"
    val days = hours / 24
    if (days < 7) return "${days}d"
    return "${days / 7}w"
}

/** A thread that held a draft in Activity: when it last had one, and whether that one went out. */
data class DraftRaise(val at: Long, val sent: Boolean)

/**
 * Activity with the threads holding unsent text first, settled ones included: the draft waits
 * on you. Snoozed threads stay on their shelf. One whose draft is gone keeps its place by when
 * it last had one, until newer activity passes it; off a shelf, only if the draft went out.
 */
fun draftsFirst(
    sections: ActivitySections,
    all: List<RemoteChatSummary>,
    drafted: Set<String>,
    raised: Map<String, DraftRaise> = emptyMap(),
): ActivitySections {
    if (drafted.isEmpty() && raised.isEmpty()) return sections
    val active = sections.active.map { it.id }.toSet()
    val snoozed = sections.snoozed.map { it.id }.toSet()
    val awake = all.filter { it.id !in snoozed }
    fun sentOff(c: RemoteChatSummary): Boolean {
        val raise = raised[c.id] ?: return false
        return raise.sent && (c.settledAt ?: 0) < raise.at && (c.snoozedAt ?: 0) < raise.at
    }
    fun stays(c: RemoteChatSummary) = c.id !in drafted && (c.id in active || sentOff(c))
    fun key(c: RemoteChatSummary) = maxOf(c.updated, raised[c.id]?.at ?: 0)
    return ActivitySections(
        active = awake.filter { it.id in drafted } + awake.filter(::stays).sortedByDescending(::key),
        snoozed = sections.snoozed,
        settled = sections.settled.filter { it.id !in drafted && !sentOff(it) },
    )
}
