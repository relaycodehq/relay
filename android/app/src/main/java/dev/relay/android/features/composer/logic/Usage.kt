package dev.relay.android.features.composer.logic

import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

// shared/provider-usage.ts, on the wall clock only: the learned active hours
// the desktop may send for the weekly pace aren't applied on the phone.

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

/** Whole-percent meter for one usage window, including the pace warning. */
fun presentWindow(window: UsageWindow, now: Long): UsageMeter {
    val used = clamp(window.usedPercent, 0.0, 100.0)
    val left = clamp((100 - used).roundToInt().toDouble(), 0.0, 100.0).toInt()
    val label = if (window.kind == "session") "Session" else "Weekly"
    val fresh = window.kind == "session" && window.resetsAt == null && used <= 0
    val resetLabel = when {
        fresh -> "Not started"
        window.resetsAt == null -> null
        else -> resetsIn(window.resetsAt, now)
    }
    val paceLeft = window.resetsAt?.let { end ->
        val start = end - window.periodMs
        val total = (end - start).toDouble()
        if (total <= 0) null else clamp((end - max(now, start)) / total * 100, 0.0, 100.0)
    }
    if (fresh) return UsageMeter(window.kind, label, 100, null, "ok", null, resetLabel)
    if (left <= 0) return UsageMeter(window.kind, label, 0, paceLeft, "spent", "Limit reached", resetLabel)
    val p = project(used, window, now)
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

private fun project(used: Double, window: UsageWindow, now: Long): Projection? {
    val resetsAt = window.resetsAt ?: return null
    val period = window.periodMs
    if (used <= 0 || period <= 0 || now >= resetsAt) return null
    val elapsed = (now - (resetsAt - period)).toDouble()
    if (elapsed < max(60_000.0, period * 0.01)) return null
    val rate = used / elapsed
    val projected = used + rate * (resetsAt - now)
    val status = if (used >= 100 || projected > 100) "behind" else if (projected <= 90) "ahead" else "onTrack"
    if (status != "ahead" && used < 5) return null
    if (status != "behind") return Projection(status, projected, null)
    val need = 100 - used
    val eta = when {
        rate <= 0 -> null
        need <= 0 -> 0L
        else -> (need / rate).let { if (now + it < resetsAt) (it / 1000).roundToLong() * 1000 else null }
    }
    return Projection(status, projected, eta)
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
