package dev.relay.android.features.thread

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.constrainHeight
import dev.relay.android.features.thread.logic.ThreadDockSize

/** Reserve disappearing status/composer space in the same measure, before the list can clamp. */
@Composable
internal fun ThreadDock(pinned: Boolean, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val size = remember { ThreadDockSize() }
    Layout(content = { Column(content = content) }, modifier = modifier) { children, constraints ->
        val child = children.single().measure(constraints.copy(minHeight = 0))
        val height = constraints.constrainHeight(size.height(child.width, child.height, constraints.maxHeight, pinned))
        layout(child.width, height) { child.placeRelative(0, height - child.height) }
    }
}
