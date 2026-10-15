package dev.relay.android.features.thread

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/**
 * Let go within this much of the bottom, the thread follows new text again. The
 * list can't scroll past its end, so this only absorbs rounding: a reader who
 * scrolled up even a little stays where they put it.
 */
private val PIN_SLACK = 8.dp

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
) {
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
    internal fun follow(items: Int) {
        if (pinned && items > 0 && !list.isScrollInProgress) list.requestScrollToItem(items - 1)
    }

    /** Back to the latest text, e.g. after sending from further up. */
    fun toBottom() {
        pinned = true
        follow(list.layoutInfo.totalItemsCount)
    }

    /** Scrolls item [index] in, its top at the top of the screen. */
    suspend fun show(index: Int) {
        list.animateScrollToItem(index)
    }

    internal suspend fun watch() {
        var scrolled = false
        // A drag or fling decides; the list's own following and the text growing don't.
        snapshotFlow { list.isScrollInProgress to below() }.collect { (scrolling, below) ->
            if (scrolling || scrolled) pinned = below != null && below <= slack
            scrolled = scrolling
        }
    }

    /** Whatever else moved the end (a picture loading, a fold, the keyboard), a frame later. */
    internal suspend fun keepUp() {
        snapshotFlow { pinned && list.canScrollForward && !list.isScrollInProgress }.collect { behind ->
            if (behind) follow(list.layoutInfo.totalItemsCount)
        }
    }
}

/**
 * [items] is how many rows the list holds. Each composition with the reader at
 * the bottom asks for the bottom before the list measures, so streamed text
 * moves the thread up in the same frame it arrives.
 */
@Composable
fun rememberThreadScroll(items: Int): ThreadScroll {
    val list = rememberLazyListState()
    val pinned = rememberSaveable { mutableStateOf(true) }
    val slack = with(LocalDensity.current) { PIN_SLACK.roundToPx() }
    val scroll = remember(list, pinned, slack) { ThreadScroll(list, pinned, slack) }
    LaunchedEffect(scroll) { scroll.watch() }
    LaunchedEffect(scroll) { scroll.keepUp() }
    SideEffect { scroll.follow(items) }
    return scroll
}
