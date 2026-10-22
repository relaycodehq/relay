package dev.relay.android.features.thread

import android.os.SystemClock
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import dev.relay.android.features.diagnostics.ScrollTrace
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.conflate
import kotlin.math.abs

/**
 * Let go within this much of the bottom, the thread follows new text again. The
 * list can't scroll past its end, so this only absorbs rounding: a reader who
 * scrolled up even a little stays where they put it.
 */
private const val PIN_SLACK_PX = 1

/**
 * The thread's list, oldest first (mobile/src/screens/thread-scroll.ts). At the
 * bottom it follows the latest text. Scrolled back, it holds on to the top of
 * what's on screen, so an answer still streaming grows below the reader instead
 * of pushing what they're reading up.
 */
@Stable
class ThreadScroll internal constructor(
    val list: LazyListState,
    private val pinnedState: MutableState<Boolean>,
    private val slack: Int,
    val trace: ScrollTrace,
) {
    private var touching by mutableStateOf(false)
    private var lastTouch = 0L
    private var lastRequest = 0L
    private var requestId = 0L
    private var requestReason: String? = null

    // Observe intent in the drag itself. A short drag can end before snapshotFlow
    // sees isScrollInProgress=true, letting a composition-follow otherwise win the race.
    val readerScroll = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (source == NestedScrollSource.UserInput && available.y > 0 && list.canScrollBackward && pinned) {
                trace.event("pin", "from" to true, "to" to false, "reason" to "reader_scroll")
                pinned = false
            }
            return Offset.Zero
        }
    }

    fun touch(pressed: Boolean, time: Long) {
        // Content can grow under a held finger without starting a Compose drag.
        // Releasing it mustn't snap past what the reader has been holding still.
        if (touching && !pressed && !list.isScrollInProgress && pinned && (below()?.let { it > slack } ?: true)) {
            trace.event("pin", "from" to true, "to" to false, "reason" to "content_changed_during_touch")
            pinned = false
        }
        touching = pressed
        lastTouch = time
    }

    private fun request(reason: String, index: Int) {
        lastRequest = SystemClock.elapsedRealtime()
        requestReason = reason
        trace.event("scroll_request", "request" to ++requestId, "reason" to reason, "targetIndex" to index,
            "firstIndex" to list.firstVisibleItemIndex, "firstOffsetPx" to list.firstVisibleItemScrollOffset,
            "pinned" to pinned, "scrolling" to list.isScrollInProgress, "touching" to touching)
    }
    /** At the bottom, following the latest text. Only the reader's own scrolling changes it. */
    var pinned: Boolean
        get() = pinnedState.value
        private set(value) {
            pinnedState.value = value
        }

    /** How far the list's end sits below the screen's, or null when its last item isn't laid out. */
    private fun below(): Int? {
        val info = list.layoutInfo
        val last = info.visibleItemsInfo.lastOrNull() ?: return 0
        if (last.index < info.totalItemsCount - 1) return null
        return last.offset + last.size - info.viewportEndOffset
    }

    /** Lines the list's end up with the screen's, in the measure that's coming. */
    internal fun follow(items: Int, reason: String) {
        if (pinned && items > 0 && !touching && !list.isScrollInProgress) {
            request(reason, items - 1)
            list.requestScrollToItem(items - 1)
        }
    }

    /** Back to the latest text, e.g. after sending from further up. */
    fun toBottom() {
        trace.event("pin", "from" to pinned, "to" to true, "reason" to "outgoing_message")
        pinned = true
        follow(list.layoutInfo.totalItemsCount, "outgoing_message")
    }

    /** Scrolls item [index] in, its top at the top of the screen. */
    suspend fun show(index: Int) {
        request("notes_message", index)
        list.animateScrollToItem(index)
        trace.event("scroll_request_finished", "reason" to "notes_message", "targetIndex" to index)
    }

    internal suspend fun watch() {
        var scrolled = false
        // A drag or fling decides; the list's own following and the text growing don't.
        snapshotFlow { list.isScrollInProgress to below() }.collect { (scrolling, below) ->
            if (scrolling != scrolled) trace.event("scroll_phase", "scrolling" to scrolling, "touching" to touching,
                "belowPx" to below, "pinned" to pinned)
            if (scrolling || scrolled) {
                val next = below != null && below <= slack
                if (next != pinned) trace.event("pin", "from" to pinned, "to" to next,
                    "reason" to "scroll_position", "belowPx" to below, "slackPx" to slack)
                pinned = next
            }
            scrolled = scrolling
        }
    }

    /** Whatever else moved the end (a picture loading, a fold, the keyboard), a frame later. */
    internal suspend fun keepUp() {
        snapshotFlow { pinned && !touching && list.canScrollForward && !list.isScrollInProgress }.collect { behind ->
            if (behind) follow(list.layoutInfo.totalItemsCount, "keep_up_after_layout")
        }
    }

    /** Read layout snapshots without introducing Compose state or requesting another layout. */
    internal suspend fun diagnose() {
        var previous: ScrollSnapshot? = null
        snapshotFlow {
            val info = list.layoutInfo
            ScrollSnapshot(list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset,
                info.viewportSize.width, info.viewportSize.height, info.viewportStartOffset, info.viewportEndOffset,
                info.totalItemsCount, list.isScrollInProgress, pinned, list.canScrollForward, list.canScrollBackward,
                info.visibleItemsInfo.map { VisibleRow(it.key.toString(), it.index, it.offset, it.size) })
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

private data class VisibleRow(val key: String, val index: Int, val offset: Int, val size: Int)
private data class ScrollSnapshot(val first: Int, val offset: Int, val width: Int, val height: Int,
    val start: Int, val end: Int, val total: Int, val scrolling: Boolean, val pinned: Boolean,
    val forward: Boolean, val backward: Boolean, val rows: List<VisibleRow>)

/**
 * [items] is how many rows the list holds. Each composition with the reader at
 * the bottom asks for the bottom before the list measures, so streamed text
 * moves the thread up in the same frame it arrives.
 */
@Composable
fun rememberThreadScroll(items: Int, trace: ScrollTrace): ThreadScroll {
    val list = rememberLazyListState()
    val pinned = rememberSaveable { mutableStateOf(true) }
    val scroll = remember(list, pinned, trace) { ThreadScroll(list, pinned, PIN_SLACK_PX, trace) }
    LaunchedEffect(scroll) { scroll.watch() }
    LaunchedEffect(scroll) { scroll.keepUp() }
    LaunchedEffect(scroll) { scroll.diagnose() }
    SideEffect { scroll.follow(items, "composition_follow") }
    return scroll
}
