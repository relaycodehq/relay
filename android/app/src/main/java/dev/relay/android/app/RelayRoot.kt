package dev.relay.android.app

import android.app.Activity
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.ToastHost
import dev.relay.android.ui.ToastState
import dev.relay.android.ui.rememberIsWide
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.RelayTheme
import dev.relay.android.ui.theme.resolveColors
import androidx.compose.foundation.isSystemInDarkTheme
import kotlinx.coroutines.channels.ReceiveChannel

/**
 * The whole app: theme, navigator, toasts, and either one stack (phone) or
 * Home in a sidebar beside a detail pane (600dp and wider).
 */
@Composable
fun RelayRoot(container: AppContainer, links: ReceiveChannel<Route>) {
    val prefs = container.prefs
    val systemDark = isSystemInDarkTheme()
    // The desktop's palette joins here once the bridge delivers it.
    val colors = remember(prefs.themeMode, systemDark) { resolveColors(prefs.themeMode, null, systemDark) }
    RelayTheme(colors) {
        SystemBars(dark = colors.isDark)
        val wide = rememberIsWide()
        val isWide by rememberUpdatedState(wide)
        val backStack = rememberNavBackStack(Route.Home)
        val navigator = remember(backStack) { AppNavigator(backStack) { isWide } }
        val toasts = remember { ToastState() }

        LaunchedEffect(navigator) { for (route in links) navigator.open(route) }

        CompositionLocalProvider(LocalNavigator provides navigator, LocalToasts provides toasts) {
            Box(Modifier.fillMaxSize().background(RelayTheme.colors.background)) {
                WideLayout(wide, prefs, sidebar = { HomeSidebar() }) {
                    NavDisplay(
                        backStack = backStack,
                        onBack = { navigator.pop() },
                        entryDecorators = listOf(
                            rememberSaveableStateHolderNavEntryDecorator(),
                            rememberViewModelStoreNavEntryDecorator(),
                        ),
                        transitionSpec = {
                            slideInHorizontally(tween(Motion.SLIDE, easing = Motion.EaseOutQuint)) { it } togetherWith
                                slideOutHorizontally(tween(Motion.SLIDE, easing = Motion.EaseOutQuint)) { -it / 4 }
                        },
                        popTransitionSpec = {
                            slideInHorizontally(tween(Motion.SLIDE, easing = Motion.EaseOutQuint)) { -it / 4 } togetherWith
                                slideOutHorizontally(tween(Motion.SLIDE, easing = Motion.EaseOutQuint)) { it }
                        },
                        predictivePopTransitionSpec = {
                            slideInHorizontally(tween(Motion.SLIDE, easing = Motion.EaseOutQuint)) { -it / 4 } togetherWith
                                slideOutHorizontally(tween(Motion.SLIDE, easing = Motion.EaseOutQuint)) { it }
                        },
                        entryProvider = entryProvider { appEntries(container) { isWide } },
                    )
                }
                ToastHost(toasts, Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.safeDrawing))
            }
        }
    }
}

@Composable
private fun SystemBars(dark: Boolean) {
    val view = LocalView.current
    if (view.isInEditMode) return
    SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
}
