package dev.relay.android.ui

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController

/**
 * A tap or scroll inside drops the keyboard, without stealing the gesture from links, buttons or
 * the list. Only while the keyboard is up, and never for a hold: that's text being selected, and
 * taking focus away would drop the selection as it's dragged wider.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Modifier.dismissKeyboardOnTap(): Modifier {
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val typing by rememberUpdatedState(WindowInsets.isImeVisible)
    return pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            if (!typing) return@awaitEachGesture
            do {
                val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: return@awaitEachGesture
                if (change.uptimeMillis - down.uptimeMillis >= viewConfiguration.longPressTimeoutMillis) return@awaitEachGesture
                val moved = (change.position - down.position).getDistance() > viewConfiguration.touchSlop
                if (moved || !change.pressed) {
                    keyboard?.hide()
                    focus.clearFocus()
                    return@awaitEachGesture
                }
            } while (change.pressed)
        }
    }
}
