package dev.relay.android.features.thread.scroll

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.scrollBy
import androidx.compose.ui.semantics.scrollToIndex
import kotlinx.coroutines.launch
import androidx.compose.ui.unit.Constraints
import dev.relay.android.features.thread.ThreadScroll
import dev.relay.android.features.diagnostics.scrollTouches

/** One viewport shared by the real conversation, gallery and device tests. */
@Composable
internal fun ThreadViewport(
    scroll: ThreadScroll,
    keys: List<String>,
    signature: ContentSignature,
    modifier: Modifier = Modifier,
    restorationComplete: Boolean = true,
    loadedHistory: Int? = null,
    empty: (@Composable ColumnScope.() -> Unit)? = null,
    dock: @Composable ColumnScope.() -> Unit = {},
    content: LazyListScope.() -> Unit,
) {
    SideEffect { scroll.content(keys, signature, restorationComplete, loadedHistory) }
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val reserve = remember(scroll) { ReadingViewport() }
    Layout(
        modifier = modifier,
        content = {
            if (empty != null) Column(content = empty) else LazyColumn(
                Modifier.nestedScroll(scroll.readerScroll).threadInput(scroll).scrollTouches(scroll.trace) { _, _ -> }
                    .semantics {
                        scrollToIndex { index ->
                            if (index !in keys.indices) false else {
                                scroll.accessibilityIntent(index < scroll.list.firstVisibleItemIndex)
                                scope.launch { scroll.accessibilityScroll(index = index) }; true
                            }
                        }
                        scrollBy { _, y ->
                            val canScroll = if (y > 0) scroll.list.canScrollForward else scroll.list.canScrollBackward
                            if (!canScroll || y == 0f) false else {
                                scroll.accessibilityIntent(y < 0)
                                scope.launch { scroll.accessibilityScroll(delta = y) }; true
                            }
                        }
                    },
                state = scroll.list,
                verticalArrangement = Arrangement.Bottom,
                content = content,
            )
            Column(content = dock)
        },
    ) { children, constraints ->
        val width = constraints.maxWidth
        val height = constraints.maxHeight
        val dockSize = children[1].measure(constraints.copy(minHeight = 0))
        val available = (height - dockSize.height).coerceAtLeast(0)
        val listHeight = reserve.height(width, available,
            holding = scroll.reading || scroll.touching, belowEnd = scroll.below())
        scroll.viewport(width, listHeight, density.fontScale, density.density)
        val list = children[0].measure(Constraints.fixed(width, listHeight))
        layout(width, height) {
            list.placeRelative(0, 0)
            dockSize.placeRelative(0, height - dockSize.height)
        }
    }
}

/** Keep a near-end reader's viewport from expanding into space that would clamp their anchor. */
internal class ReadingViewport {
    private var width = -1
    private var held: Int? = null

    fun height(width: Int, available: Int, holding: Boolean, belowEnd: Int?): Int {
        if (this.width != width || !holding) held = null
        this.width = width
        val previous = held
        val increase = available - (previous ?: available)
        val safe = belowEnd == null || belowEnd >= increase
        val next = if (previous == null || available <= previous || safe) available
            else previous
        held = next
        return next
    }
}

/** Input continues working when diagnostics are absent. This observes and never consumes touches. */
private fun Modifier.threadInput(scroll: ThreadScroll) = pointerInput(scroll) {
    try {
        awaitPointerEventScope {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                scroll.touch(event.changes.any { it.pressed })
            }
        }
    } finally { scroll.touch(false) }
}
