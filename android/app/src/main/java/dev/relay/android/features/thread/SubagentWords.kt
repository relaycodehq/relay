package dev.relay.android.features.thread

import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.features.thread.logic.liveLabel
import dev.relay.android.remote.model.ChatPending
import dev.relay.android.remote.model.SubagentRun

// shared/subagents.ts: subagents a thread's agent started, as the strip, its sheet and a run's screen show them.

/** Working agents first, each group in the order they started. */
val bySubagentStanding: Comparator<SubagentRun> =
    compareByDescending<SubagentRun> { it.status == "running" }.thenBy { it.started }

/** Runs that overlapped in time, oldest first: one fan-out each. */
fun subagentBatches(runs: List<SubagentRun>, now: Long = System.currentTimeMillis()): List<List<SubagentRun>> {
    val batches = mutableListOf<MutableList<SubagentRun>>()
    var until = Long.MIN_VALUE
    for (run in runs.sortedBy { it.started }) {
        if (run.started > until) batches += mutableListOf<SubagentRun>()
        batches.last() += run
        val end = if (run.status == "running") now else run.ended ?: run.started
        until = maxOf(until, end)
    }
    return batches
}

/** Every agent that overlapped the ones still running; empty once they're all back. */
fun runningBatch(runs: List<SubagentRun>, now: Long = System.currentTimeMillis()): List<SubagentRun> {
    val last = subagentBatches(runs, now).lastOrNull() ?: return emptyList()
    return if (last.any { it.status == "running" }) last else emptyList()
}

/** The thread's background work minus the agents the strip already shows. */
fun outsideBatch(pending: List<ChatPending>, batch: List<SubagentRun>): List<ChatPending> {
    val shown = batch.map { it.taskId }.toSet()
    return pending.filter { it.id !in shown }
}

private val MODEL_ID = Regex("^claude-([a-z]+)-(\\d+)(?:-(\\d{1,2}))?(?:-\\d{8})?(?:\\[1m\\])?$")

/** "claude-opus-5-5" reads "Opus 5.5"; an alias like "haiku" reads "Haiku". */
fun modelName(model: String): String {
    fun cap(w: String) = w.replaceFirstChar { it.uppercaseChar() }
    MODEL_ID.find(model)?.let { m ->
        val (family, major, minor) = m.destructured
        return "${cap(family)} $major${if (minor.isNotEmpty()) ".$minor" else ""}"
    }
    return if (Regex("^[a-z]+$").matches(model)) cap(model) else model
}

/** "26s", "4m 05s", "1h 03m". */
fun took(ms: Long): String {
    val s = maxOf(0L, ms / 1000)
    if (s < 60) return "${s}s"
    val m = s / 60
    if (m < 60) return "${m}m ${(s % 60).toString().padStart(2, '0')}s"
    return "${m / 60}h ${(m % 60).toString().padStart(2, '0')}m"
}

/** "Explore agent", or just "Agent" for the default kind. */
fun agentKind(run: SubagentRun): String {
    val type = run.type
    return if (!type.isNullOrEmpty() && type != "general-purpose" && type != "general")
        "${type.replaceFirstChar { it.uppercaseChar() }} agent" else "Agent"
}

/** The thread's agent that started it and reads what it reports. */
fun leadName(run: SubagentRun) = agentName(run.provider ?: "claude")

/** What it's on now, from its ~30s summary, or how it ended. */
fun subagentNow(run: SubagentRun): String {
    if (run.status == "running") {
        val current = run.recent.lastOrNull { it.status == "running" }
        return run.summary ?: current?.let(::liveLabel) ?: "Starting…"
    }
    val outcome = run.outcome?.split(Regex("(?<=\\.)\\s"))?.firstOrNull()
    if (run.status == "idle") return outcome ?: "Child status unavailable"
    if (run.status == "completed") return outcome ?: "Done"
    return if (run.status == "failed") "Failed" else "Stopped"
}
