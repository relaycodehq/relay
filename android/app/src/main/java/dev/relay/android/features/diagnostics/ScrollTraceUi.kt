package dev.relay.android.features.diagnostics

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned

val LocalScrollTrace = staticCompositionLocalOf<ScrollTrace?> { null }

/** Observe only: never consume input, request focus, or change measurements. */
@Composable
fun Modifier.scrollGeometry(trace: ScrollTrace?, element: String): Modifier {
    if (trace == null) return this
    val previous = remember(trace, element) { arrayOfNulls<List<Int>>(1) }
    return onGloballyPositioned { coordinates ->
        val rect = coordinates.boundsInWindow()
        val values = listOf(coordinates.size.width, coordinates.size.height, rect.left.toInt(), rect.top.toInt())
        if (previous[0] != values) {
            trace.event("geometry", "element" to element, "widthPx" to values[0], "heightPx" to values[1],
                "windowX" to values[2], "windowY" to values[3], "previous" to previous[0])
            previous[0] = values
        }
    }
}

fun Modifier.scrollTouches(trace: ScrollTrace?, onTouch: (Boolean, Long) -> Unit): Modifier {
    if (trace == null) return this
    return pointerInput(trace) {
        var touching = false
        var lastMove = 0L
        try {
            awaitPointerEventScope {
                while (true) {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    val pressed = event.changes.any { it.pressed }
                    val now = SystemClock.elapsedRealtime()
                    onTouch(pressed, now)
                    if (pressed != touching || now - lastMove >= 100) {
                        val point = event.changes.firstOrNull()?.position
                        trace.event("touch", "phase" to if (pressed == touching) "move" else if (pressed) "down" else "up",
                            "xPx" to point?.x, "yPx" to point?.y, "pointers" to event.changes.count { it.pressed })
                        lastMove = now
                    }
                    touching = pressed
                }
            }
        } finally {
            onTouch(false, SystemClock.elapsedRealtime())
            if (touching) trace.event("touch", "phase" to "cancel")
        }
    }
}
