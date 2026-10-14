package dev.relay.android.features.git

import dev.relay.android.remote.model.CiRun

/** How much a run's state says about the commit: a failure outranks all (shared/ci.ts). */
private fun rank(state: String) = when (state) {
    "skipped" -> -1
    "success" -> 0
    "running" -> 1
    "failure" -> 2
    else -> -1
}

data class CiSummary(val state: String, val target: CiRun)

/**
 * The state the icon wears and the run a tap opens: a failure outranks a run
 * still going, which outranks a pass; a pass opens the latest run. Null when
 * no run has a verdict.
 */
fun ciSummary(runs: List<CiRun>): CiSummary? {
    val counted = runs.filter { it.state != "skipped" }
    if (counted.isEmpty()) return null
    val worst = counted.reduce { a, b -> if (rank(b.state) > rank(a.state)) b else a }
    val target = if (worst.state == "success") counted.reduce { a, b -> if (b.at > a.at) b else a } else worst
    return CiSummary(worst.state, target)
}

/** "now", "5m", "3h", "2d", "1w" (shared/chat-activity `shortAge`). */
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
