package dev.relay.android.features.thread.logic

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

// shared/chat-activity.ts's clock words, in the phone's own zone and locale.

class Clock(val zone: ZoneId = ZoneId.systemDefault(), val locale: Locale = Locale.getDefault()) {
    private val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)

    private fun at(ms: Long): ZonedDateTime = Instant.ofEpochMilli(ms).atZone(zone)
    private fun days(from: ZonedDateTime, to: ZonedDateTime) = ChronoUnit.DAYS.between(from.toLocalDate(), to.toLocalDate())

    /** "13:25" or "1:25 PM", as the phone's locale writes it. */
    fun clock(ms: Long): String = at(ms).format(time)

    /** When a message was sent: "13:25", "Yesterday 13:25", "Tuesday 13:25", "Sep 3, 13:25". */
    fun sentLabel(sent: Long, now: Long): String {
        val a = at(sent)
        val n = at(now)
        val t = clock(sent)
        val d = days(a, n)
        if (d <= 0) return t
        if (d == 1L) return "Yesterday $t"
        if (d < 7) return "${a.dayOfWeek.getDisplayName(TextStyle.FULL, locale)} $t"
        val pattern = if (a.year == n.year) "MMM d" else "MMM d, yyyy"
        return "${a.format(DateTimeFormatter.ofPattern(pattern, locale))}, $t"
    }

    /** "17:30", "tomorrow 9:00", "Mon 9:00", "Oct 3, 9:00". */
    fun wakeLabel(until: Long, now: Long): String {
        val w = at(until)
        val ahead = days(at(now), w)
        val day = when {
            ahead <= 0 -> ""
            ahead == 1L -> "tomorrow "
            ahead < 7 -> "${w.dayOfWeek.getDisplayName(TextStyle.SHORT, locale)} "
            else -> "${w.format(DateTimeFormatter.ofPattern("MMM d", locale))}, "
        }
        return day + clock(until)
    }

    private fun dayAt(from: ZonedDateTime, days: Long, hour: Int): Long =
        LocalDate.from(from).plusDays(days).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    /** Snooze's quick choices. */
    fun snoozePresets(now: Long): List<Pair<String, Long>> {
        val n = at(now)
        val hour = 3_600_000L
        val toMonday = if (n.dayOfWeek == DayOfWeek.SUNDAY) 8L else 7L - (n.dayOfWeek.value - 1)
        return buildList {
            add("15 minutes" to now + hour / 4)
            add("1 hour" to now + hour)
            add("3 hours" to now + 3 * hour)
            // Past five the evening is too close to be worth a choice of its own.
            if (n.hour < 17) add("This evening" to dayAt(n, 0, 18))
            add("Tomorrow" to dayAt(n, 1, 9))
            add("Next week" to dayAt(n, toMonday, 9))
        }
    }
}
