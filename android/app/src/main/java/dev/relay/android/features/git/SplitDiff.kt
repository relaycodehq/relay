package dev.relay.android.features.git

import dev.relay.android.remote.model.DiffLine
import dev.relay.android.remote.model.RemoteDiff

/** A row of the unified view: a hunk header or one line. */
sealed interface DiffRow {
    data class Hunk(val header: String) : DiffRow
    data class Line(val line: DiffLine) : DiffRow
}

/** A row of the side-by-side view. A missing side is blank. */
sealed interface SplitRow {
    data class Hunk(val header: String) : SplitRow
    data class Pair(val left: DiffLine?, val right: DiffLine?) : SplitRow
}

fun unifiedRows(diff: RemoteDiff): List<DiffRow> =
    diff.hunks.flatMap { h -> listOf(DiffRow.Hunk(h.header)) + h.lines.map(DiffRow::Line) }

/**
 * A diff as side-by-side rows (mobile/src/remote/split-diff.ts): unchanged
 * lines on both sides, and each run of removed lines set against the added
 * lines that replaced it, one for one, with a blank side where one run is longer.
 */
fun splitRows(diff: RemoteDiff): List<SplitRow> {
    val rows = mutableListOf<SplitRow>()
    for (hunk in diff.hunks) {
        rows += SplitRow.Hunk(hunk.header)
        val removed = mutableListOf<DiffLine>()
        val added = mutableListOf<DiffLine>()
        fun flush() {
            for (i in 0 until maxOf(removed.size, added.size)) rows += SplitRow.Pair(removed.getOrNull(i), added.getOrNull(i))
            removed.clear()
            added.clear()
        }
        for (line in hunk.lines) {
            when (line.kind) {
                "del" -> {
                    // A removal after additions starts a new change.
                    if (added.isNotEmpty()) flush()
                    removed += line
                }
                "add" -> added += line
                else -> {
                    flush()
                    rows += SplitRow.Pair(line, line)
                }
            }
        }
        flush()
    }
    return rows
}
