package dev.relay.android.features.applock

import android.view.ViewGroup
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import dev.relay.android.ui.theme.RelayTheme

/**
 * A window of its own over the whole screen, edge to edge and undimmed. Over Relay's sheets and
 * dialogs too, which are windows as well: drawn inside the activity, the lock would sit under them.
 */
@Composable
fun LockWindow(onBack: () -> Unit, content: @Composable () -> Unit) {
    Dialog(
        onDismissRequest = onBack,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
        ),
    ) {
        val view = LocalView.current
        val dark = RelayTheme.colors.isDark
        SideEffect {
            val window = (view.parent as? DialogWindowProvider)?.window ?: return@SideEffect
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.setWindowAnimations(0)
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
        content()
    }
}

/** Six digits typed one at a time; [full] hears them once the last is in. */
class PinTyping(private val full: PinTyping.(String) -> Unit) {
    var text by mutableStateOf("")
        private set

    fun digit(d: Char) {
        if (text.length >= LockWords.PIN_LENGTH) return
        text += d
        if (text.length == LockWords.PIN_LENGTH) full(text)
    }

    fun delete() {
        text = text.dropLast(1)
    }

    fun clear() {
        text = ""
    }
}

@Composable
fun rememberPinTyping(full: PinTyping.(String) -> Unit): PinTyping {
    val latest = remember { mutableStateOf(full) }
    latest.value = full
    return remember { PinTyping { latest.value(this, it) } }
}
