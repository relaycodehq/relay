package dev.relay.android.features.thread

import android.os.SystemClock
import androidx.compose.runtime.snapshotFlow
import dev.relay.android.features.diagnostics.ScrollTrace
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.conflate
import kotlin.math.abs

/** Observes scrolling; recording is deliberately outside the input and follow policy. */
internal class ThreadScrollDiagnostics(private val trace: ScrollTrace?) {
    private var touching = false
    private var lastTouch = 0L
    private var lastRequest = 0L
    private var requestId = 0L
    private var requestReason: String? = null

    fun touch(pressed: Boolean, time: Long) { touching = pressed; lastTouch = time }

    fun request(reason: String, index: Int, scroll: ThreadScroll) {
        lastRequest = SystemClock.elapsedRealtime()
        requestReason = reason
        trace?.event("scroll_request", "request" to ++requestId, "reason" to reason, "targetIndex" to index,
            "firstIndex" to scroll.list.firstVisibleItemIndex, "firstOffsetPx" to scroll.list.firstVisibleItemScrollOffset,
            "pinned" to scroll.pinned, "scrolling" to scroll.list.isScrollInProgress, "touching" to touching)
    }

    suspend fun observe(scroll: ThreadScroll) {
        val trace = trace ?: return
        val list = scroll.list
        var previous: Snapshot? = null
        snapshotFlow {
            val info = list.layoutInfo
            Snapshot(list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset,
                info.viewportSize.width, info.viewportSize.height, info.viewportStartOffset, info.viewportEndOffset,
                info.totalItemsCount, list.isScrollInProgress, scroll.pinned, list.canScrollForward, list.canScrollBackward,
                info.visibleItemsInfo.map { Row(it.key.toString(), it.index, it.offset, it.size) })
        }.conflate().collect { state ->
            val now = SystemClock.elapsedRealtime()
            val before = previous
            val anchor = state.rows.firstNotNullOfOrNull { row ->
                before?.rows?.find { it.key == row.key }?.let { it.offset - row.offset }
            }
            val recentRequest = lastRequest > 0 && now - lastRequest < 500
            val recentTouch = touching || (lastTouch > 0 && now - lastTouch < 500)
            val fields = mapOf(
                "firstIndex" to state.first, "firstOffsetPx" to state.offset,
                "widthPx" to state.width, "heightPx" to state.height,
                "viewportStartPx" to state.start, "viewportEndPx" to state.end, "totalItems" to state.total,
                "scrolling" to state.scrolling, "touching" to touching, "pinned" to state.pinned,
                "canScrollForward" to state.forward, "canScrollBackward" to state.backward,
                "anchorShiftPx" to anchor, "lastRequest" to requestId, "lastRequestReason" to requestReason,
                "requestAgeMs" to if (lastRequest > 0) now - lastRequest else null,
                "cause" to when { recentRequest -> "recent_app_request"; recentTouch || state.scrolling -> "gesture_or_fling"; else -> "unattributed" },
                "rows" to state.rows.map { mapOf("key" to it.key, "index" to it.index, "offsetPx" to it.offset, "sizePx" to it.size) },
            )
            trace.event("layout", fields)
            val jumped = if (anchor != null) abs(anchor) > maxOf(100, state.height / 3)
                else before != null && before.rows.isNotEmpty() && state.rows.isNotEmpty() && before.first != state.first
            if (before != null && !state.scrolling && !before.scrolling && !recentTouch && !recentRequest && jumped)
                trace.recorder.suspect(trace, fields)
            previous = state
            delay(100)
        }
    }
}
private data class Row(val key: String, val index: Int, val offset: Int, val size: Int)
private data class Snapshot(val first: Int, val offset: Int, val width: Int, val height: Int,
    val start: Int, val end: Int, val total: Int, val scrolling: Boolean, val pinned: Boolean,
    val forward: Boolean, val backward: Boolean, val rows: List<Row>)
