package dev.relay.android.features.thread.scroll

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.node.LayoutModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.constrainHeight

internal class StableGeometryState {
    private var width = -1
    private var maximum = 0

    fun height(width: Int, content: Int, holding: Boolean): Int {
        maximum = if (!holding || this.width != width) content else maxOf(maximum, content)
        this.width = width
        return maximum
    }

    /** The next measurement starts from the row's natural height. */
    fun forget() { width = -1 }
}

/**
 * Holds shrinking transient chrome; the child is always measured at its natural height.
 * The reserve ends when the row leaves the screen: off screen it keeps nothing still,
 * and kept, it comes back as a blank gap.
 */
internal fun Modifier.stableGeometry(state: StableGeometryState, holding: Boolean): Modifier =
    this then StableGeometryElement(state, holding)

@Composable
internal fun Modifier.stableGeometry(holding: Boolean): Modifier = stableGeometry(remember { StableGeometryState() }, holding)

private data class StableGeometryElement(val state: StableGeometryState, val holding: Boolean) : ModifierNodeElement<StableGeometryNode>() {
    override fun create() = StableGeometryNode(state, holding)
    override fun update(node: StableGeometryNode) {
        node.state = state
        node.holding = holding
    }
}

private class StableGeometryNode(var state: StableGeometryState, var holding: Boolean) : Modifier.Node(), LayoutModifierNode {
    override fun MeasureScope.measure(measurable: Measurable, constraints: Constraints): MeasureResult {
        val child = measurable.measure(constraints.copy(minHeight = 0))
        val height = constraints.constrainHeight(state.height(child.width, child.height, holding))
        return layout(child.width, height) { child.placeRelative(0, 0) }
    }

    override fun onDetach() = state.forget()
}
