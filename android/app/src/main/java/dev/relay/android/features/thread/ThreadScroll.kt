package dev.relay.android.features.thread

import android.os.SystemClock
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.unit.Velocity
import dev.relay.android.features.diagnostics.ScrollTrace
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.RowAnchor
import dev.relay.android.features.thread.scroll.SavedScroll
import dev.relay.android.features.thread.scroll.ScrollEffect
import dev.relay.android.features.thread.scroll.ScrollEvent
import dev.relay.android.features.thread.scroll.ScrollMode
import dev.relay.android.features.thread.scroll.ScrollPolicy
import dev.relay.android.features.thread.scroll.ScrollState
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job

/** One intent policy owns follow/navigation; keyed restores and resize anchors use LazyList directly. */
@Stable
class ThreadScroll internal constructor(
    val list: LazyListState,
    val trace: ScrollTrace?,
    saved: SavedScroll? = null,
) {
    private var state = ScrollState()
    private var mode by mutableStateOf<ScrollMode>(ScrollMode.Following)
    val pinned: Boolean get() = mode == ScrollMode.Following
    val reading: Boolean get() = !pinned
    var touching by mutableStateOf(false)
        private set
    internal val diagnostics = ThreadScrollDiagnostics(trace)
    private var navigation: Job? = null
    private var navigationId = 0L
    private var keys: List<String> = emptyList()
    private var pendingAnchor: RowAnchor? = null
    private var prependKeys: List<String>? = null
    private var prependHistory: Int? = null
    private var previousSize: Pair<Int, Int>? = null
    private var previousTextScale: Pair<Float, Float>? = null
    private var resizeAnchor: Pair<String, Float>? = null

    init { accept(ScrollEvent.Opened(saved)) }

    private fun accept(event: ScrollEvent) {
        val (next, effects) = ScrollPolicy.reduce(state, event)
        state = next
        // Geometry changes every frame. Only intent changes should recompose the screen.
        mode = next.mode
        touching = next.pointerDown
        for (effect in effects) when (effect) {
            is ScrollEffect.RequestEnd -> {
                val end = keys.lastIndex
                if (end >= 0) {
                    diagnostics.request(effect.reason, end, this)
                    list.requestScrollToItem(end)
                }
            }
            is ScrollEffect.RequestRow -> pendingAnchor = effect.anchor
            is ScrollEffect.CancelNavigation -> { navigation?.cancel(); navigation = null }
            is ScrollEffect.Transition -> trace?.event("pin", "from" to (effect.from == ScrollMode.Following),
                "to" to (effect.to == ScrollMode.Following), "reason" to effect.cause,
                "mode" to effect.to.toString())
        }
        if (state.mode !is ScrollMode.Restoring) { pendingAnchor = null; prependKeys = null; prependHistory = null }
    }

    internal fun content(keys: List<String>, signature: ContentSignature, restorationComplete: Boolean, loadedHistory: Int?) {
        this.keys = keys
        restoreIfAvailable(restorationComplete, loadedHistory)
        accept(ScrollEvent.Content(signature))
    }

    internal fun viewport(width: Int, height: Int, fontScale: Float, density: Float) {
        val size = width to height
        val scale = fontScale to density
        if (state.mode == ScrollMode.Reading && !touching && !list.isScrollInProgress && ((previousSize != null && previousSize?.first != width) ||
                (previousTextScale != null && previousTextScale != scale))) {
            list.layoutInfo.visibleItemsInfo.firstOrNull()?.let { row ->
                resizeAnchor = row.key.toString() to (-row.offset.toFloat() / row.size.coerceAtLeast(1)).coerceIn(0f, 1f)
                keys.indexOf(row.key.toString()).takeIf { it >= 0 }?.let { index ->
                    diagnostics.request("resize_anchor", index, this)
                    list.requestScrollToItem(index)
                }
            }
        }
        previousTextScale = scale
        if (size != previousSize) {
            previousSize = size
            accept(ScrollEvent.ViewportChanged)
        }
    }

    internal fun below(): Int? {
        val info = list.layoutInfo
        if (info.totalItemsCount == 0) return 0
        val last = info.visibleItemsInfo.lastOrNull() ?: return null
        if (last.index != info.totalItemsCount - 1) return null
        return last.offset + last.size - info.viewportEndOffset
    }

    fun touch(pressed: Boolean, time: Long = SystemClock.elapsedRealtime()) {
        diagnostics.touch(pressed, time)
        if (pressed == state.pointerDown) return
        if (pressed) accept(ScrollEvent.PointerDown)
        else {
            accept(ScrollEvent.EndObserved(below()))
            accept(ScrollEvent.PointerUp)
        }
    }

    val readerScroll = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (source == NestedScrollSource.UserInput && available.y != 0f) {
                accept(ScrollEvent.UserScroll(towardOlder = available.y > 0 && list.canScrollBackward))
                // Synchronous intent precedes snapshotFlow, including a drag ending within one frame.
                if (!state.scrolling) accept(ScrollEvent.ScrollStarted(owned = false))
            }
            return Offset.Zero
        }
        override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
            accept(ScrollEvent.Settled(below()))
            return Velocity.Zero
        }
    }

    fun toBottom(reason: String = "outgoing_message") { accept(ScrollEvent.ToBottom(reason)) }

    /** Semantic actions may complete between snapshot samples; intent must precede their mutation. */
    internal fun accessibilityIntent(towardOlder: Boolean) {
        accept(ScrollEvent.UserScroll(towardOlder))
        accept(ScrollEvent.ScrollStarted(owned = false))
    }

    internal suspend fun accessibilityScroll(index: Int? = null, delta: Float = 0f) {
        try {
            if (index != null) list.scrollToItem(index) else list.animateScrollBy(delta)
        } finally { accept(ScrollEvent.Settled(below())) }
    }


    suspend fun show(key: String): Unit = coroutineScope {
        val index = keys.indexOf(key)
        if (index < 0) return@coroutineScope
        val id = ++navigationId
        accept(ScrollEvent.Navigate(id))
        navigation = currentCoroutineContext().job
        accept(ScrollEvent.ScrollStarted(owned = true))
        var completed = false
        try {
            diagnostics.request("notes_message", index, this@ThreadScroll)
            list.animateScrollToItem(index)
            completed = true
        } finally {
            if ((state.mode as? ScrollMode.Navigating)?.id == id) navigation = null
            accept(ScrollEvent.NavigationEnded(id, completed, below()))
        }
    }

    /** Capture the first message row, rather than the history button that will remain above the new page. */
    internal fun preserveForPrepend(requestedHistory: Int? = null) {
        val row = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key != "earlier" } ?: return
        val anchor = RowAnchor(row.key.toString(), -row.offset)
        prependKeys = keys
        prependHistory = requestedHistory
        accept(ScrollEvent.Opened(SavedScroll(false, anchor)))
    }

    internal fun save(): SavedScroll {
        // Keep a pending key while the cache/network is still loading the rows.
        val anchor = pendingAnchor ?: list.layoutInfo.visibleItemsInfo.firstOrNull { it.key != "earlier" && it.key != "end" && it.key != "bottom" }?.let {
            RowAnchor(it.key.toString(), -it.offset)
        }
        return SavedScroll(pinned, anchor)
    }

    private fun restoreIfAvailable(complete: Boolean, loadedHistory: Int?) {
        val mode = state.mode as? ScrollMode.Restoring ?: return
        val anchor = pendingAnchor ?: return
        if (keys.isEmpty()) return
        val before = prependKeys
        if (before != null) {
            val requested = prependHistory
            if (requested != null) {
                if (loadedHistory == null || loadedHistory < requested) return
            } else {
                // Unrelated streaming changes at the tail must not acknowledge a history prepend.
                val boundary = before.firstOrNull { it != "earlier" && it != "end" && it != "bottom" }
                if (boundary == null || keys.indexOf(boundary) <= before.indexOf(boundary)) return
            }
        }
        val index = keys.indexOf(anchor.key)
        if (index >= 0) {
            diagnostics.request("restore_anchor", index, this)
            list.requestScrollToItem(index, anchor.offsetPx)
            accept(ScrollEvent.RestoreResult(mode.token, true))
        } else if (complete) {
            // Prefer the same message if an edit removed the saved source line.
            val message = anchor.key.substringBefore(':')
            val fallback = keys.indexOfFirst { it.substringBefore(':') == message }
                .takeIf { it >= 0 } ?: list.firstVisibleItemIndex.coerceIn(0, keys.lastIndex)
            diagnostics.request("restore_missing_anchor", fallback, this)
            list.requestScrollToItem(fallback)
            accept(ScrollEvent.RestoreResult(mode.token, false))
        }
    }

    private fun restoreResizedAnchor() {
        val (key, fraction) = resizeAnchor ?: return
        val row = list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key } ?: return
        resizeAnchor = null
        val index = keys.indexOf(key)
        if (index >= 0 && state.mode == ScrollMode.Reading && !touching && !list.isScrollInProgress) {
            diagnostics.request("resize_anchor_offset", index, this)
            list.requestScrollToItem(index, (row.size * fraction).toInt().coerceAtMost((row.size - 1).coerceAtLeast(0)))
        }
    }

    internal suspend fun observe() {
        var scrolling = false
        snapshotFlow { list.isScrollInProgress to list.layoutInfo }
            .collect { (moving, _) ->
                val below = below()
                if (moving && !scrolling && !state.scrolling)
                    accept(ScrollEvent.ScrollStarted(owned = navigation != null))
                if (!moving && scrolling)
                    accept(ScrollEvent.Settled(below))
                scrolling = moving
                restoreResizedAnchor()
                accept(ScrollEvent.EndObserved(below))
            }
    }
}

@Composable
fun rememberThreadScroll(trace: ScrollTrace? = null): ThreadScroll {
    val list = rememberLazyListState()
    val saver = listSaver<ThreadScroll, Any>(
        save = { val saved = it.save(); listOf(saved.following, saved.anchor?.key ?: "", saved.anchor?.offsetPx ?: 0) },
        restore = { ThreadScroll(list, trace, SavedScroll(it[0] as Boolean,
            (it[1] as String).takeIf(String::isNotEmpty)?.let { key -> RowAnchor(key, it[2] as Int) })) },
    )
    val scroll = rememberSaveable(list, trace, saver = saver) { ThreadScroll(list, trace) }
    LaunchedEffect(scroll) { scroll.observe() }
    LaunchedEffect(scroll) { scroll.diagnostics.observe(scroll) }
    return scroll
}
