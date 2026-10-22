package dev.relay.android.features.thread.logic

/** Reclaiming dock space near the end can clamp a reader's scroll position. Keep it until they return. */
internal class ThreadDockSize {
    private var width = -1
    private var held = 0

    fun height(width: Int, content: Int, maximum: Int, pinned: Boolean): Int {
        held = if (pinned || this.width != width) content else maxOf(held, content)
        this.width = width
        held = held.coerceAtMost(maximum)
        return held
    }
}
