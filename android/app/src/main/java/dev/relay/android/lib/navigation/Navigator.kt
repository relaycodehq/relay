package dev.relay.android.lib.navigation

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * How screens move. On a wide window the stack's bottom is Home in the
 * sidebar, so `openInPane` swaps the detail pane's contents while `push`
 * stacks inside it. On a phone both push.
 */
interface Navigator {
    val stack: List<Route>
    /** Whether the top screen should show a back button: false for a pane's first screen on wide. */
    val canGoBack: Boolean
    fun push(route: Route)
    fun pop(): Boolean
    /** Replaces the top screen (a pairing finishing into Home, a new thread into its Thread). */
    fun replace(route: Route)
    /** Opens a top-level destination from the list: on wide it replaces the pane, on narrow it pushes. */
    fun openInPane(route: Route)
    /** Back to Home with nothing above it. */
    fun home()
}

val LocalNavigator = staticCompositionLocalOf<Navigator> { error("No Navigator: wrap the screen in the app shell") }

/** What a TopBar's back button does: pop, or nothing on a pane's first screen. */
val Navigator.backAction: (() -> Unit)? get() = if (canGoBack) ({ pop() }) else null
