package dev.relay.android.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController

/** A tap or scroll inside drops the keyboard, without stealing the gesture from links, buttons or the list. */
@Composable
fun Modifier.dismissKeyboardOnTap(): Modifier {
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    return pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            // Any tap or drag counts; only a long press (copy, actions) keeps the keyboard up.
            do {
                val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: return@awaitEachGesture
                val moved = (change.position - down.position).getDistance() > viewConfiguration.touchSlop
                val tapped = !change.pressed && change.uptimeMillis - down.uptimeMillis < viewConfiguration.longPressTimeoutMillis
                if (moved || tapped) {
                    keyboard?.hide()
                    focus.clearFocus()
                    return@awaitEachGesture
                }
            } while (change.pressed)
        }
    }
}
