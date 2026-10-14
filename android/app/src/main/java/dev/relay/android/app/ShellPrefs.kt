package dev.relay.android.app

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import dev.relay.android.ui.theme.ThemeMode

/**
 * The shell's own settings: theme and the sidebar. SharedPreferences rather
 * than DataStore because the first frame needs them synchronously; a flash of
 * the wrong theme or a sidebar jumping width is worse than a tiny disk read.
 */
class ShellPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("relay-shell", Context.MODE_PRIVATE)

    var themeMode by mutableStateOf(
        prefs.getString(THEME, null)?.let { name -> ThemeMode.entries.find { it.name == name } } ?: ThemeMode.Computer,
    )
        private set

    fun setTheme(mode: ThemeMode) {
        themeMode = mode
        prefs.edit { putString(THEME, mode.name) }
    }

    /** dp, or null until the user drags it. */
    var sidebarWidth by mutableStateOf(prefs.getFloat(SIDEBAR_WIDTH, -1f).takeIf { it > 0f })
        private set

    fun saveSidebarWidth(dp: Float) {
        sidebarWidth = dp
        prefs.edit { putFloat(SIDEBAR_WIDTH, dp) }
    }

    var sidebarHidden by mutableStateOf(prefs.getBoolean(SIDEBAR_HIDDEN, false))
        private set

    fun hideSidebar(hidden: Boolean) {
        sidebarHidden = hidden
        prefs.edit { putBoolean(SIDEBAR_HIDDEN, hidden) }
    }

    private companion object {
        const val THEME = "relay-theme"
        const val SIDEBAR_WIDTH = "relay-sidebar-width"
        const val SIDEBAR_HIDDEN = "relay-sidebar-hidden"
    }
}
