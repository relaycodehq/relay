package dev.relay.android.features.thread.scroll

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.constrainHeight

/** Retain with the row key so LazyColumn recycling doesn't forget its reserved space. */
internal class StableGeometryState {
    private var width = -1
    private var maximum = 0

    fun height(width: Int, content: Int, holding: Boolean): Int {
        maximum = if (!holding || this.width != width) content else maxOf(maximum, content)
        this.width = width
        return maximum
    }
}

/** Holds shrinking transient chrome; the child is always measured at its natural height. */
internal fun Modifier.stableGeometry(state: StableGeometryState, holding: Boolean): Modifier = layout { measurable, constraints ->
    val child = measurable.measure(constraints.copy(minHeight = 0))
    val height = constraints.constrainHeight(state.height(child.width, child.height, holding))
    layout(child.width, height) { child.placeRelative(0, 0) }
}

@Composable
internal fun Modifier.stableGeometry(holding: Boolean): Modifier = stableGeometry(remember { StableGeometryState() }, holding)
