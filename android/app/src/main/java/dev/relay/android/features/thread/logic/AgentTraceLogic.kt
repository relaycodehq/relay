package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.AgentTrace
import dev.relay.android.remote.model.ChatMessage

// shared/agent-trace.ts: how an agent turn reads while it runs and once it ends.

private val IMAGE_PATH = Regex("\\.(?:png|jpe?g|gif|webp)$", RegexOption.IGNORE_CASE)

fun isImagePath(path: String) = IMAGE_PATH.containsMatchIn(path)

/** A turn's events in order; saves from before traces kept only the calls. */
fun traceOf(message: ChatMessage): List<AgentTrace> =
    message.trace ?: (message.activity ?: emptyList()).map { AgentTrace("activity", it.id, activity = it) }

/** The picture a call looked at or made, by path. */
fun imagePath(a: AgentActivity): String? = a.image ?: a.label.takeIf { a.kind == "read" && isImagePath(it) }

/** A call that looks at or made an image Relay can show; it's still running or done. */
fun looksAtImage(a: AgentActivity) = (a.status == "running" || a.status == "complete") && imagePath(a) != null

/** The image a finished call looked at or made. */
fun imageRead(a: AgentActivity): String? = if (looksAtImage(a) && a.status == "complete") imagePath(a) else null

/** The line under a stopped turn, which only claims output was kept when there is some. */
fun stoppedNote(message: ChatMessage) =
    if (message.body.isNotBlank() || traceOf(message).isNotEmpty() || !message.changes.isNullOrEmpty())
        "Stopped · partial output kept" else "Stopped"

sealed interface TracePart {
    val id: String
    data class Commentary(override val id: String, val text: String) : TracePart
    data class Run(override val id: String, val activity: List<AgentActivity>) : TracePart
}

/** Consecutive tool calls become one run; commentary splits them, and a question stands as a run of its own. */
fun groupTrace(entries: List<AgentTrace>): List<TracePart> {
    val parts = mutableListOf<TracePart>()
    for (entry in entries) {
        val activity = entry.activity
        if (entry.isCommentary || activity == null) {
            parts += TracePart.Commentary(entry.id, entry.text ?: "")
            continue
        }
        val last = parts.lastOrNull()
        if (last is TracePart.Run && !isQuestionCall(activity) && !isQuestionCall(last.activity.first()))
            parts[parts.lastIndex] = last.copy(activity = last.activity + activity)
        else parts += TracePart.Run(entry.id, listOf(activity))
    }
    return parts
}

/** How a run of calls shows in an open trace. */
enum class RunShape { Live, Rows, Group }

/**
 * The batch still being worked on is one live row, and a single call is its own row. A finished
 * turn's only run lists every call, its summary being the heading already; not while the turn
 * runs or is held open for a reader, or the run would unfold the moment the agent writes after
 * it and fold again at its next call, moving everything under it.
 */
fun runShape(parts: List<TracePart>, index: Int, live: Boolean, settled: Boolean): RunShape {
    val run = parts[index] as TracePart.Run
    return when {
        live && index == parts.lastIndex && !isQuestionCall(run.activity.first()) -> RunShape.Live
        run.activity.size == 1 -> RunShape.Rows
        settled && parts.all { it === run || it is TracePart.Commentary } -> RunShape.Rows
        else -> RunShape.Group
    }
}

/** Everything a turn's heading and trace are drawn from. */
data class TurnRead(
    val live: Boolean,
    val entries: List<AgentTrace>,
    /** Entries with subagents' calls taken out. */
    val shown: List<AgentTrace>,
    /** The calls subagents made, by the agent call that ran them. */
    val calls: Map<String, List<AgentActivity>>,
    /** The agent's own calls. */
    val activity: List<AgentActivity>,
    val current: AgentActivity?,
    /** Between calls with nothing written yet: the thinking line shows. */
    val thinking: Boolean,
)

fun readTurn(message: ChatMessage): TurnRead {
    val live = message.streaming
    val entries = traceOf(message)
    val ids = entries.map { it.id }.toSet()
    val calls = LinkedHashMap<String, MutableList<AgentActivity>>()
    val shown = entries.filter { e ->
        val a = e.activity ?: return@filter true
        val parent = a.parentId
        // An orphan, its agent row dropped from a full trace, stays in line.
        if (parent == null || parent !in ids) return@filter true
        calls.getOrPut(parent) { mutableListOf() }.add(a)
        false
    }
    val activity = shown.mapNotNull { if (it.isCommentary) null else it.activity }
    val current = if (live) activity.lastOrNull { it.status == "running" } else null
    return TurnRead(live, entries, shown, calls, activity, current, live && current == null && message.body.isEmpty())
}

sealed interface TurnHeading {
    data object Working : TurnHeading
    data class Call(val activity: AgentActivity) : TurnHeading
    data object Writing : TurnHeading
    data object Thinking : TurnHeading
    data class Done(val text: String, val last: AgentActivity?) : TurnHeading
}

/** What a turn's heading says. Open while live it's the whole run; folded, it stands in for the one live row. */
fun turnHeading(message: ChatMessage, expanded: Boolean, turn: TurnRead = readTurn(message)): TurnHeading {
    if (!turn.live)
        return TurnHeading.Done(summarizeActivity(turn.activity, message.traceDropped).ifEmpty { "Thought" }, turn.activity.lastOrNull())
    if (expanded) return TurnHeading.Working
    turn.current?.let { return TurnHeading.Call(it) }
    return if (message.body.isNotEmpty()) TurnHeading.Writing else TurnHeading.Thinking
}

/** The batch still being worked on shows one row: its running call, else its latest; the rest fold behind it. */
fun batchHead(activity: List<AgentActivity>): Pair<AgentActivity, List<AgentActivity>> {
    val head = activity.lastOrNull { it.status == "running" } ?: activity.last()
    return head to activity.filter { it !== head }
}

private val thinkingWords = listOf(
    "Thinking", "Pondering", "Mulling it over", "Noodling", "Ruminating", "Percolating", "Cogitating", "Brewing",
    "Tinkering", "Musing", "Scheming", "Untangling", "Marinating", "Puzzling", "Chewing on it", "Connecting dots",
)

/** JS `[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0`. */
private fun hash(text: String): Long {
    var h = 7
    var i = 0
    while (i < text.length) {
        val cp = text.codePointAt(i)
        // charCodeAt(0) of a code point string is its first UTF-16 unit.
        h = h * 31 + text[i].code
        i += Character.charCount(cp)
    }
    return h.toLong() and 0xFFFFFFFFL
}

/** The turn's word for this six-second window: the same on every remount. */
fun thinkingWord(seed: String, now: Long = System.currentTimeMillis()): String =
    thinkingWords[(hash("$seed:${Math.floorDiv(now, 6000L)}") % thinkingWords.size).toInt()]
