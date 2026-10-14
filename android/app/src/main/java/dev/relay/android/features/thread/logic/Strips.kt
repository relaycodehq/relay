package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.ChatPending
import dev.relay.android.remote.model.ThreadGoal
import java.util.Locale
import kotlin.math.roundToLong

// shared/goal.ts presentGoal and shared/waiting.ts: what the strips above the composer say.

data class GoalShown(
    val title: String,
    val objective: String,
    val usage: String,
    val detail: String?,
    val working: Boolean,
)

private val goalTitles = mapOf(
    "active" to "Pursuing goal",
    "paused" to "Goal paused",
    "blocked" to "Goal blocked",
    "usage_limited" to "Goal hit a usage limit",
    "budget_limited" to "Goal reached its token budget",
    "complete" to "Goal complete",
    "failed" to "Goal can't be met",
)

private fun goalTokens(value: Long) = when {
    value < 1_000 -> "$value"
    value < 1_000_000 -> "${(value / 1_000.0).roundToLong()}k"
    else -> String.format(Locale.US, "%.1f", value / 1_000_000.0).removeSuffix(".0") + "M"
}

private fun goalMinutes(seconds: Double): String {
    val m = (seconds / 60).toLong()
    return if (m < 60) "${m}m" else "${m / 60}h ${m % 60}m"
}

/** An active goal on an idle thread is set, not pursued. */
fun presentGoal(goal: ThreadGoal, running: Boolean): GoalShown {
    val usage = buildList {
        val used = goal.tokensUsed
        if (used != null && used != 0L)
            add(if (goal.tokenBudget != null && goal.tokenBudget != 0L) "${goalTokens(used)} / ${goalTokens(goal.tokenBudget)} tokens" else "${goalTokens(used)} tokens")
        goal.timeUsedSeconds?.takeIf { it >= 60 }?.let { add(goalMinutes(it)) }
        goal.checks?.takeIf { it != 0 }?.let { add("$it ${if (it == 1) "check" else "checks"}") }
    }
    return GoalShown(
        title = if (goal.status == "active" && !running) (if (goal.gaveUp == true) "Goal not met yet" else "Goal set")
        else goalTitles[goal.status] ?: goal.status,
        objective = goal.objective,
        usage = usage.joinToString(" · "),
        detail = if (goal.status == "failed" || goal.gaveUp == true) goal.lastCheck else null,
        working = running && goal.status == "active",
    )
}

/** "12s", "3m", "1h 4m": minutes are enough once it has run a while. */
fun span(ms: Long): String {
    val seconds = maxOf(0L, (ms / 1000.0).roundToLong())
    if (seconds < 60) return "${seconds}s"
    val minutes = seconds / 60
    return if (minutes < 60) "${minutes}m" else "${minutes / 60}h ${minutes % 60}m"
}

fun wakeupTitle(item: ChatPending, clock: (Long) -> String): String =
    item.at?.let { "Claude will check back at ${clock(it)}" } ?: "Claude checks back on a schedule"

fun timing(item: ChatPending, now: Long): String? {
    if (item.kind == "task") return span(now - (item.since ?: now))
    val at = item.at ?: return null
    return if (at > now) "in ${span(at - now)}" else "any moment"
}

/** When the oldest subagent Claude left running started, if any. */
fun agentsSince(pending: List<ChatPending>?): Long? =
    pending?.filter { it.kind == "task" && it.agent == true }?.mapNotNull { it.since }?.minOrNull()

/** The waiting strip's head line: title, then a muted detail. */
fun waitingSummary(pending: List<ChatPending>, now: Long, clock: (Long) -> String): Pair<String, String> {
    val tasks = pending.filter { it.kind == "task" }
    val wakeups = pending.size - tasks.size
    val first = pending.first()
    if (first.kind == "wakeup") {
        val whenText = timing(first, now)
        return wakeupTitle(first, clock) to
            ((if (whenText != null) " · $whenText" else "") + (if (pending.size > 1) " · +${pending.size - 1} more" else ""))
    }
    val also = if (wakeups > 0) " · +$wakeups ${if (wakeups == 1) "wake-up" else "wake-ups"}" else ""
    if (tasks.size > 1) return "${tasks.size} running in the background" to also
    return (first.description ?: "") to " · running in the background · ${timing(first, now)}$also"
}

/** "Run the A/B" reads as "…waiting on run the A/B"; acronyms keep their case. */
fun lowerFirst(text: String) =
    if (Regex("^[A-Z][a-z]").containsMatchIn(text)) text[0].lowercaseChar() + text.substring(1) else text
