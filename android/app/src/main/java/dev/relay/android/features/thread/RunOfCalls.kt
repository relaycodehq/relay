package dev.relay.android.features.thread

// A run of tool calls between two lines of commentary (the desktop's Run.tsx).
// While the agent works on it, each call is a row of its own in the order it
// came; once commentary or the end of the turn closes it, the rows give way to
// the run's grouped form.

import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.updateTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.layout
import dev.relay.android.features.thread.logic.rowsOf
import dev.relay.android.features.thread.logic.toldByActions
import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.rememberReducedMotion
import dev.relay.android.ui.theme.Motion
import kotlin.math.roundToInt

@Composable
internal fun RunOfCalls(
    calls: List<AgentActivity>,
    /** The agent is still on it: its calls show one by one, ungrouped. */
    live: Boolean,
    /** The turn's only run, which its heading already sums up. */
    only: Boolean,
) {
    val inFront by rememberInFront()
    val moves = inFront && !rememberReducedMotion()
    val run = updateTransition(live, label = "run")
    val rowsShown = run.animateFloat(
        { if (moves) tween(Motion.SLIDE, easing = Motion.EaseOutQuint) else snap() },
        label = "rows",
    ) { open -> if (open) 1f else 0f }
    // The grouped form opens in above while the rows fold away under it, so
    // the run's height eases from one to the other.
    val closing = moves && run.currentState && !run.targetState
    Column {
        if (!live) Box(if (closing) Modifier.revealed { 1f - rowsShown.value } else Modifier) { GroupedCalls(calls, only) }
        if (live || closing) Box(if (closing) Modifier.revealed { rowsShown.value } else Modifier) { CallsInOrder(calls) }
    }
}

/** Each call a row of its own, in the order it came. */
@Composable
private fun CallsInOrder(calls: List<AgentActivity>) {
    val rows = remember(calls) { if (toldByActions(calls)) rowsOf(calls) else null }
    Column {
        if (rows != null) for (row in rows) key(row.id) { ActionRow(row) }
        else for (call in calls) key(call.id) { ToolRow(call) }
    }
}

/** A closed run by what its calls did; an older desktop's calls say only what they were. */
@Composable
private fun GroupedCalls(calls: List<AgentActivity>, only: Boolean) {
    when {
        toldByActions(calls) -> ClosedRun(calls, only)
        calls.size == 1 || only -> Column { for (call in calls) key(call.id) { ToolRow(call) } }
        else -> ActivityGroup(calls)
    }
}

/** Shows [fraction] of the block's height, fading with it; read at layout, so easing it never recomposes. */
private fun Modifier.revealed(fraction: () -> Float) = clipToBounds().layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val shown = fraction().coerceIn(0f, 1f)
    layout(placeable.width, (placeable.height * shown).roundToInt()) {
        placeable.placeWithLayer(0, 0) { alpha = shown }
    }
}
