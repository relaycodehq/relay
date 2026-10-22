package dev.relay.android.features.diagnostics

import androidx.compose.ui.unit.IntSize
import dev.relay.android.remote.model.ChatMessage

data class ThreadLogState(val all: List<ChatMessage>, val listed: List<ChatMessage>, val earlier: Int?, val running: Boolean)

/** Last measured heights, explicitly distinct from unmeasured lazy rows. Lives only with its thread screen. */
class ThreadMeasurements(val trace: ScrollTrace) {
    private val sizes = mutableMapOf<String, IntSize>()
    private var previous = emptyMap<String, Map<String, Any?>>()
    private var rowMessages = emptyList<Pair<String, String?>>()

    fun rows(rows: List<Pair<String, String?>>) {
        val old = rowMessages.map { it.first }.toSet()
        rowMessages = rows
        val keys = rows.map { it.first }
        keys.chunked(100).forEachIndexed { i, chunk -> trace.event("row_order", "chunk" to i, "keys" to chunk) }
        val removed = old - keys.toSet()
        removed.chunked(100).forEach { trace.event("rows_removed", "keys" to it) }
        sizes.keys.retainAll(keys.toSet())
    }

    fun size(key: String, size: IntSize) {
        val before = sizes.put(key, size)
        if (before != size) trace.event("row_size", "key" to key, "widthPx" to size.width,
            "heightPx" to size.height, "previousHeightPx" to before?.height, "previousWidthPx" to before?.width)
    }

    fun messages(all: List<ChatMessage>, listed: List<ChatMessage>, earlier: Int?, running: Boolean, full: Boolean = false) {
        val parts = rowMessages.filter { it.second != null }.groupBy({ it.second }, { it.first })
        // Pending sends can already be visible before the computer's full thread contains them.
        val current = (all + listed).associateBy { it.id }.values.associate { m ->
            val keys = parts[m.id].orEmpty()
            val measured = keys.mapNotNull(sizes::get)
            m.id to mapOf(
            "key" to m.id, "parent" to m.parentId, "role" to m.role, "status" to m.status, "version" to m.version,
            "bodyChars" to m.body.length, "traceEntries" to m.trace.orEmpty().size,
            "traceChars" to m.trace.orEmpty().sumOf { (it.text?.length ?: 0) + (it.activity?.detail?.length ?: 0) },
            "activities" to m.activity.orEmpty().size, "images" to m.images.orEmpty().size,
            "renders" to m.renders.orEmpty().map { mapOf("id" to it.id, "pages" to it.pages.size) },
            "rowKeys" to keys, "measuredParts" to measured.size,
            "measuredHeightPx" to if (keys.isNotEmpty() && measured.size == keys.size) measured.sumOf { it.height } else null,
            "measuredWidthPx" to measured.map { it.width }.distinct().singleOrNull(),
        ) }
        trace.event("thread_state", "loadedMessages" to all.size, "listedMessages" to listed.size,
            "earlier" to (earlier ?: 0), "running" to running, "full" to full,
            "measuredRows" to sizes.size, "knownHeightPx" to sizes.values.sumOf { it.height.toLong() })
        if (full) rowMessages.map { it.first }.chunked(100).forEachIndexed { i, keys ->
            trace.event("row_order", "chunk" to i, "keys" to keys)
        }
        val changed = current.values.filter { full || previous[it["key"]] != it }
        changed.chunked(30).forEach { trace.event("message_metadata", "messages" to it) }
        previous = current
    }
}
