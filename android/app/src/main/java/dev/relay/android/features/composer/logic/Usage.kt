package dev.relay.android.features.composer.logic

import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

// shared/provider-usage.ts. The desktop learns the active hours
// (shared/usage-history.ts); the phone only paces the week by them.

@Serializable
data class UsageWindow(val kind: String, val usedPercent: Double, val resetsAt: Long? = null, val periodMs: Long)

@Serializable
data class UsageCredits(val balance: Double, val unlimited: Boolean, val messages: List<Double>? = null)

@Serializable
data class ProviderUsage(
    val provider: String,
    val windows: List<UsageWindow> = emptyList(),
    val message: String? = null,
    val activeHours: List<Double>? = null,
    val credits: UsageCredits? = null,
)

/** "ok" | "warn" | "hot" | "spent" */
data class UsageMeter(
    val kind: String,
    val label: String,
    val leftPercent: Int,
    val paceLeftPercent: Double?,
    val pace: String,
    val limitLabel: String?,
    val resetLabel: String?,
)

private const val FIVE_MINUTES = 5 * 60 * 1000L
private const val HOUR = 60 * 60 * 1000L
private const val BEHIND_HOT = 10

/** Rounded up to the minute, two units at most: "7m", "3h", "3h 20m", "2d 5h". */
fun compactDuration(ms: Long): String? {
    if (ms <= 0) return null
    val minutes = max(1L, ceil(ms / 60_000.0).toLong())
    val hours = minutes / 60
    if (hours >= 24) return "${hours / 24}d ${hours % 24}h"
    val rest = minutes % 60
    if (hours == 0L) return "${rest}m"
    return if (rest != 0L) "${hours}h ${rest}m" else "${hours}h"
}

fun resetsIn(at: Long, now: Long): String? {
    if (at - now <= FIVE_MINUTES) return "Resets soon"
    return compactDuration(at - now)?.let { "Resets in $it" }
}

private fun outIn(ms: Long): String? {
    if (ms <= FIVE_MINUTES) return "Out soon"
    return compactDuration(ms)?.let { "Out in ~$it" }
}

private fun clamp(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))

/** Start of the next local hour, which half-hour time zones don't align. */
fun nextHour(t: Long, zone: ZoneId = ZoneId.systemDefault()): Long {
    val next = Instant.ofEpochMilli(t).atZone(zone).truncatedTo(ChronoUnit.HOURS).plusHours(1).toInstant().toEpochMilli()
    return if (next > t) next else t + HOUR
}

/** Hours of usual work between two moments, each local hour weighted by the profile. */
fun activeWeight(profile: List<Double>, from: Long, to: Long, zone: ZoneId = ZoneId.systemDefault()): Double {
    var total = 0.0
    var t = from
    while (t < to) {
        val next = min(to, nextHour(t, zone))
        total += (profile.getOrElse(Instant.ofEpochMilli(t).atZone(zone).hour) { 0.0 }) * (next - t) / HOUR
        t = next
    }
    return total
}

/** Time that counts toward a limit's burn between two moments. */
private typealias Clock = (from: Long, to: Long) -> Double

private val wallClock: Clock = { from, to -> (to - from).toDouble() }

private fun clockFor(window: UsageWindow, activeHours: List<Double>?): Clock? {
    // Only the week spans nights and weekends; a session is all working time.
    if (window.kind != "weekly" || activeHours == null || activeHours.size != 24) return null
    return { from, to -> activeWeight(activeHours, from, to) * HOUR }
}

private fun paceLeft(clock: Clock, start: Long, end: Long, now: Long): Double? {
    val total = clock(start, end)
    if (total <= 0) return null
    return clamp(clock(max(now, start), end) / total * 100, 0.0, 100.0)
}

/**
 * Whole-percent meter for one usage window, including the pace warning. With
 * the hours someone usually works, the week's burn and pace only count those.
 */
fun presentWindow(window: UsageWindow, now: Long, activeHours: List<Double>? = null): UsageMeter {
    val used = clamp(window.usedPercent, 0.0, 100.0)
    val left = clamp((100 - used).roundToInt().toDouble(), 0.0, 100.0).toInt()
    val label = if (window.kind == "session") "Session" else "Weekly"
    val fresh = window.kind == "session" && window.resetsAt == null && used <= 0
    val resetLabel = when {
        fresh -> "Not started"
        window.resetsAt == null -> null
        else -> resetsIn(window.resetsAt, now)
    }
    val active = clockFor(window, activeHours)
    val clock = active ?: wallClock
    val paceLeft = window.resetsAt?.let { paceLeft(clock, it - window.periodMs, it, now) }
    if (fresh) return UsageMeter(window.kind, label, 100, null, "ok", null, resetLabel)
    if (left <= 0) return UsageMeter(window.kind, label, 0, paceLeft, "spent", "Limit reached", resetLabel)
    val p = project(used, window, now, clock, active != null)
    return when (p?.status) {
        "ahead" -> UsageMeter(window.kind, label, left, paceLeft, "ok", null, resetLabel)
        "onTrack" -> {
            val spare = (100 - p.projected).roundToInt()
            UsageMeter(window.kind, label, left, paceLeft, if (spare >= 1) "warn" else "hot", if (spare >= 1) "~$spare% spare" else null, resetLabel)
        }
        "behind" -> {
            // A few points past the pace mark is one lighter afternoon, not a fire.
            val behind = (paceLeft ?: 100.0) - left
            UsageMeter(window.kind, label, left, paceLeft, if (behind >= BEHIND_HOT) "hot" else "warn", p.eta?.let(::outIn), resetLabel)
        }
        else -> {
            val percent = used.roundToInt()
            UsageMeter(window.kind, label, left, paceLeft, if (percent >= 90) "hot" else if (percent >= 80) "warn" else "ok", null, resetLabel)
        }
    }
}

private class Projection(val status: String, val projected: Double, val eta: Long?)

private fun project(used: Double, window: UsageWindow, now: Long, clock: Clock, learned: Boolean): Projection? {
    val resetsAt = window.resetsAt ?: return null
    val period = window.periodMs
    if (used <= 0 || period <= 0 || now >= resetsAt) return null
    val elapsed = clock(resetsAt - period, now)
    // Learned hours already skip nights, so an hour of real work is enough.
    val minElapsed = if (learned) HOUR.toDouble() else max(60_000.0, period * 0.01)
    if (elapsed < minElapsed) return null
    val rate = used / elapsed
    val projected = used + rate * clock(now, resetsAt)
    val status = if (used >= 100 || projected > 100) "behind" else if (projected <= 90) "ahead" else "onTrack"
    if (status != "ahead" && used < 5) return null
    if (status != "behind") return Projection(status, projected, null)
    return Projection(status, projected, runsOutIn(used, rate, now, resetsAt, clock))
}

/** Wall time until the limit is hit at this rate, if before the reset. */
private fun runsOutIn(used: Double, rate: Double, now: Long, resetsAt: Long, clock: Clock): Long? {
    val need = 100 - used
    if (rate <= 0) return null
    if (need <= 0) return 0
    // Both clocks run evenly within an hour, so solve one hour at a time.
    var spent = 0.0
    var t = now
    while (t < resetsAt) {
        val next = min(resetsAt, nextHour(t))
        val burn = rate * clock(t, next)
        if (spent + burn >= need) {
            val at = t + (need - spent) / burn * (next - t)
            return ((at - now) / 1000).roundToLong() * 1000
        }
        spent += burn
        t = next
    }
    return null
}

/** "5% ahead" with more left than an even burn would leave, "3% behind" running hot. */
fun paceGap(meter: UsageMeter): String? {
    val pace = meter.paceLeftPercent ?: return null
    if (meter.pace == "spent") return null
    val gap = meter.leftPercent - pace.roundToInt()
    return if (gap == 0) "On pace" else if (gap > 0) "$gap% ahead" else "${-gap}% behind"
}

private fun grouped(n: Double) = NumberFormat.getIntegerInstance(Locale.US).format(n.roundToLong())

fun creditsLabel(c: UsageCredits) = if (c.unlimited) "Unlimited credits" else "${grouped(c.balance)} credits"

fun creditsReach(c: UsageCredits): String? {
    val m = c.messages?.takeIf { it.size == 2 } ?: return null
    if (c.unlimited) return null
    val (low, high) = m.map(::grouped)
    return if (low == high) "~$low messages" else "~$low–$high messages"
}
