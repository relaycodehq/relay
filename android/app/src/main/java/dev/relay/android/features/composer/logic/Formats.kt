package dev.relay.android.features.composer.logic

import java.text.DateFormat
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** shared/tokens.ts: 950, 12.5k, 128k, 1.2M. */
fun formatTokens(n: Long): String {
    fun one(v: Double) = String.format(Locale.US, "%.1f", v).removeSuffix(".0")
    return when {
        n < 1_000 -> n.toString()
        n < 10_000 -> "${one(n / 1_000.0)}k"
        n < 1_000_000 -> "${(n / 1_000.0).roundToLong()}k"
        else -> "${one(n / 1_000_000.0)}M"
    }
}

/** shared/openrouter-credit.ts: $3, $2.50, $1,234, −$4.20. */
fun formatDollars(value: Double): String {
    val a = abs(value)
    val digits = if (a >= 100 || a == Math.floor(a)) 0 else 2
    val f = NumberFormat.getNumberInstance(Locale.US).apply {
        minimumFractionDigits = digits
        maximumFractionDigits = digits
    }
    return "${if (value < 0) "−" else ""}$${f.format(a)}"
}

/** shared/thread-cost.ts. */
fun formatCost(usd: Double) = if (usd < 0.01) "<$0.01" else formatDollars(usd)

data class LaterPreset(val label: String, val at: Long)

private fun dayAt(now: Long, days: Int, hour: Int): Long = Calendar.getInstance().run {
    timeInMillis = now
    add(Calendar.DAY_OF_MONTH, days)
    set(Calendar.HOUR_OF_DAY, hour)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
    timeInMillis
}

/** shared/chat-activity.ts sendLaterPresets. */
fun sendLaterPresets(now: Long): List<LaterPreset> {
    val hour = Calendar.getInstance().run { timeInMillis = now; get(Calendar.HOUR_OF_DAY) }
    return buildList {
        add(LaterPreset("In 30 minutes", now + 1_800_000))
        add(LaterPreset("In 1 hour", now + 3_600_000))
        add(LaterPreset("In 3 hours", now + 10_800_000))
        if (hour < 17) add(LaterPreset("This evening", dayAt(now, 0, 18)))
        add(LaterPreset("Tomorrow morning", dayAt(now, 1, 9)))
    }
}

private fun calendarDays(from: Long, to: Long): Long {
    // Rounded: a day the clocks change on lasts 23 or 25 hours.
    return Math.round((dayAt(to, 0, 0) - dayAt(from, 0, 0)) / 86_400_000.0)
}

/** "17:30", "tomorrow 9:00", "Mon 9:00", "Oct 3, 9:00". */
fun wakeLabel(until: Long, now: Long, locale: Locale = Locale.getDefault()): String {
    val ahead = calendarDays(now, until)
    val date = Date(until)
    val day = when {
        ahead <= 0 -> ""
        ahead == 1L -> "tomorrow "
        ahead < 7 -> SimpleDateFormat("EEE", locale).format(date) + " "
        else -> SimpleDateFormat("MMM d", locale).format(date) + ", "
    }
    return day + DateFormat.getTimeInstance(DateFormat.SHORT, locale).format(date)
}

private val pasteBlock = Regex(
    "(?:^|\\n\\n?)Pasted text #(\\d+):\\n\\n(`{3,})\\n([\\s\\S]*?)\\n\\2(?:\\n\\n|$)",
)

/** `text`'s first `end` characters without splitting a surrogate pair. */
private fun sliceWhole(text: String, end: Int): String {
    if (end >= text.length) return text
    var e = end
    if (e > 0 && Character.isLowSurrogate(text[e])) e--
    return text.substring(0, e)
}

/** shared/prompt-title.ts: what a thread is called until a generated title comes. */
fun promptTitle(body: String): String {
    val pastes = pasteBlock.findAll(body).map { it.groupValues[3] }.toList()
    val text = pasteBlock.replace(body, "\n\n")
    val title = (
        agentMentionPattern.replace(text, "").trim().ifEmpty {
            pastes.firstOrNull()?.trimStart()?.substringBefore('\n') ?: ""
        }
        ).trim()
    return sliceWhole(title, 65).ifEmpty { "Screenshot" }
}

/** A send's text as it was written and where it goes; an unchanged failed one retries with its own id. */
data class ComposeDraft<Image>(val target: String, val body: String, val settings: dev.relay.android.remote.model.ResumeSettings, val images: List<Image>)

data class ComposeAttempt<Image>(
    val draft: ComposeDraft<Image>,
    val id: String,
    /** "queue" | "steer" */
    val delivery: String? = null,
    val sendAt: Long? = null,
)

fun <Image> sameDraft(a: ComposeDraft<Image>, b: ComposeDraft<Image>) =
    a.target == b.target && a.body == b.body && a.images === b.images && a.settings == b.settings

/** mobile/src/remote/compose-attempt.ts: an unchanged failed draft retries its original delivery and id. */
fun <Image> composeAttempt(
    draft: ComposeDraft<Image>,
    delivery: String?,
    sendAt: Long?,
    failed: ComposeAttempt<Image>?,
    createId: () -> String,
): ComposeAttempt<Image> =
    if (failed != null && sameDraft(draft, failed.draft)) failed
    else ComposeAttempt(draft, createId(), delivery, sendAt)
