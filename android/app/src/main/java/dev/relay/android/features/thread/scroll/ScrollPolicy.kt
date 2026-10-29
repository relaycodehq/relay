package dev.relay.android.features.thread.scroll

data class RowAnchor(val key: String, val offsetPx: Int)
data class SavedScroll(val following: Boolean, val anchor: RowAnchor?)
data class ContentSignature(val rows: Int, val lastKey: String?, val tailVersion: Long, val endHash: Int)

sealed interface ScrollMode {
    data object Following : ScrollMode
    data object Reading : ScrollMode
    data class Navigating(val id: Long) : ScrollMode
    data class Restoring(val token: Long, val anchor: RowAnchor) : ScrollMode
}

data class ScrollState(
    val mode: ScrollMode = ScrollMode.Following,
    val pointerDown: Boolean = false,
    val endMovedDuringHold: Boolean = false,
    val scrolling: Boolean = false,
    val ownScroll: Boolean = false,
    val applied: ContentSignature? = null,
    val belowEndPx: Int? = 0,
    val nextRestoreToken: Long = 1,
    val readerSettledAtEnd: Boolean = false,
    /** How many things the reader is opening or closing; nothing follows until they have laid out. */
    val unfolding: Int = 0,
)

sealed interface ScrollEvent {
    data class Opened(val saved: SavedScroll?) : ScrollEvent
    data object PointerDown : ScrollEvent
    data object PointerUp : ScrollEvent
    data class UserScroll(val towardOlder: Boolean) : ScrollEvent
    data class ScrollStarted(val owned: Boolean) : ScrollEvent
    data class Settled(val belowEndPx: Int?) : ScrollEvent
    data class Content(val signature: ContentSignature) : ScrollEvent
    data class EndObserved(val belowEndPx: Int?) : ScrollEvent
    data object ViewportChanged : ScrollEvent
    data class Navigate(val id: Long) : ScrollEvent
    data class NavigationEnded(val id: Long, val completed: Boolean, val belowEndPx: Int?) : ScrollEvent
    data class ToBottom(val reason: String) : ScrollEvent
    data class RestoreResult(val token: Long, val applied: Boolean) : ScrollEvent
    data object ReaderUnfold : ScrollEvent
    data class UnfoldSettled(val belowEndPx: Int?) : ScrollEvent
}

sealed interface ScrollEffect {
    data class RequestEnd(val reason: String) : ScrollEffect
    data class RequestRow(val anchor: RowAnchor, val reason: String) : ScrollEffect
    /** Keep the rows where they are, over a scroll to the end not laid out yet. */
    data object Stay : ScrollEffect
    data class CancelNavigation(val id: Long) : ScrollEffect
    data class Transition(val from: ScrollMode, val to: ScrollMode, val cause: String) : ScrollEffect
}

/** The only owner of scroll intent. Geometry alone never takes a reader back to following. */
object ScrollPolicy {
    private fun atEnd(below: Int?) = below != null && below <= 1

    fun reduce(before: ScrollState, event: ScrollEvent): Pair<ScrollState, List<ScrollEffect>> {
        var state = before
        val effects = mutableListOf<ScrollEffect>()
        fun mode(next: ScrollMode, cause: String) {
            val previous = state.mode
            if (previous == next) return
            if (previous is ScrollMode.Navigating) effects += ScrollEffect.CancelNavigation(previous.id)
            state = state.copy(mode = next)
            effects += ScrollEffect.Transition(previous, next, cause)
        }
        fun follow(reason: String) {
            if (state.mode == ScrollMode.Following && !state.pointerDown && !state.scrolling && state.unfolding == 0 &&
                (state.applied?.rows ?: 0) > 0) effects += ScrollEffect.RequestEnd(reason)
        }
        fun observe(below: Int?) {
            state = state.copy(belowEndPx = below,
                endMovedDuringHold = state.endMovedDuringHold || (state.pointerDown && !atEnd(below)))
        }
        when (event) {
            is ScrollEvent.Opened -> {
                state = state.copy(pointerDown = false, scrolling = false, ownScroll = false,
                    endMovedDuringHold = false, readerSettledAtEnd = false)
                val saved = event.saved
                when {
                    saved == null || saved.following -> {
                        mode(ScrollMode.Following, "open_following")
                        follow("open_following")
                    }
                    saved.anchor != null -> {
                        val token = state.nextRestoreToken
                        state = state.copy(nextRestoreToken = token + 1)
                        mode(ScrollMode.Restoring(token, saved.anchor), "open_anchor")
                        effects += ScrollEffect.RequestRow(saved.anchor, "restore")
                    }
                    else -> mode(ScrollMode.Reading, "open_without_anchor")
                }
            }
            ScrollEvent.PointerDown -> {
                if (state.mode is ScrollMode.Navigating || state.mode is ScrollMode.Restoring)
                    mode(ScrollMode.Reading, "pointer_preempted_navigation")
                state = state.copy(pointerDown = true, endMovedDuringHold = false, readerSettledAtEnd = false)
            }
            ScrollEvent.PointerUp -> {
                if (state.pointerDown && state.endMovedDuringHold && !atEnd(state.belowEndPx))
                    mode(ScrollMode.Reading, "end_moved_during_hold")
                else if (state.readerSettledAtEnd && state.mode == ScrollMode.Reading && atEnd(state.belowEndPx))
                    mode(ScrollMode.Following, "reader_reached_end")
                state = state.copy(pointerDown = false, endMovedDuringHold = false, readerSettledAtEnd = false)
                follow("pointer_released")
            }
            is ScrollEvent.UserScroll -> {
                if (event.towardOlder || state.mode is ScrollMode.Navigating || state.mode is ScrollMode.Restoring)
                    mode(ScrollMode.Reading, "reader_scroll")
            }
            is ScrollEvent.ScrollStarted -> {
                state = state.copy(scrolling = true, ownScroll = event.owned, readerSettledAtEnd = false)
                if (!event.owned) mode(ScrollMode.Reading, "external_scroll")
            }
            is ScrollEvent.Settled -> {
                val external = state.scrolling && !state.ownScroll
                state = state.copy(scrolling = false, ownScroll = false)
                observe(event.belowEndPx)
                state = state.copy(readerSettledAtEnd = external && atEnd(event.belowEndPx))
                if (external && !state.pointerDown && state.mode == ScrollMode.Reading && atEnd(event.belowEndPx))
                    mode(ScrollMode.Following, "reader_reached_end")
                follow("scroll_settled")
            }
            is ScrollEvent.Content -> {
                if (state.applied != event.signature) {
                    state = state.copy(applied = event.signature)
                    follow("content_changed")
                }
            }
            is ScrollEvent.EndObserved -> {
                observe(event.belowEndPx)
                if (!atEnd(event.belowEndPx)) follow("end_layout_changed")
            }
            ScrollEvent.ViewportChanged -> follow("viewport_changed")
            is ScrollEvent.Navigate -> mode(ScrollMode.Navigating(event.id), "navigate")
            is ScrollEvent.NavigationEnded -> {
                val navigating = state.mode as? ScrollMode.Navigating
                if (navigating?.id == event.id) {
                    // The animation has already ended; there is nothing left to cancel.
                    val next = if (event.completed && atEnd(event.belowEndPx)) ScrollMode.Following else ScrollMode.Reading
                    state = state.copy(mode = next, scrolling = false, ownScroll = false)
                    effects += ScrollEffect.Transition(navigating, next, "navigation_ended")
                    observe(event.belowEndPx)
                }
            }
            is ScrollEvent.ToBottom -> {
                mode(ScrollMode.Following, event.reason)
                follow(event.reason)
            }
            ScrollEvent.ReaderUnfold -> {
                state = state.copy(unfolding = state.unfolding + 1)
                // Lifting the finger already asked for the end, which would land with what opens.
                if (state.mode == ScrollMode.Following) effects += ScrollEffect.Stay
            }
            is ScrollEvent.UnfoldSettled -> {
                observe(event.belowEndPx)
                state = state.copy(unfolding = (state.unfolding - 1).coerceAtLeast(0))
                // What the reader opened stays under their finger; the thread follows on only if its end still shows.
                // A fold's steps arriving overlap the tap that opened it, and the last to lay out decides.
                when {
                    state.unfolding > 0 -> {}
                    state.mode == ScrollMode.Following && !atEnd(event.belowEndPx) -> mode(ScrollMode.Reading, "reader_unfolded")
                    else -> follow("unfold_settled")
                }
            }
            is ScrollEvent.RestoreResult -> {
                if ((state.mode as? ScrollMode.Restoring)?.token == event.token)
                    mode(ScrollMode.Reading, if (event.applied) "anchor_restored" else "anchor_unavailable")
            }
        }
        return state to effects
    }
}
