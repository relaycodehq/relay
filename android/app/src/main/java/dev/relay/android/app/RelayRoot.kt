package dev.relay.android.app

import android.app.Activity
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import dev.relay.android.features.home.ConnectionLine
import dev.relay.android.features.home.NeedsYou
import dev.relay.android.features.markdown.LocalOpensLocalhost
import dev.relay.android.features.tunnel.rememberTunnelLinks
import dev.relay.android.features.tunnel.rememberTunnels
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.remote.model.PhoneAppearance
import dev.relay.android.remote.model.PhonePalette
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.ui.LocalScreenNotice
import dev.relay.android.ui.theme.DesktopAppearance
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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private fun PhonePalette.toMap(): Map<String, String> =
    RemoteJson.encodeToJsonElement(PhonePalette.serializer(), this).jsonObject.mapValues { it.value.jsonPrimitive.content }

private fun PhoneAppearance.toDesktop() = DesktopAppearance(mode, light.toMap(), dark.toMap())

/** Whether this process has looked at the back stack it started with. */
private var stackRestored = false

/**
 * The whole app: theme, navigator, toasts, and either one stack (phone) or
 * Home in a sidebar beside a detail pane (600dp and wider).
 */
@Composable
fun RelayRoot(container: AppContainer, links: ReceiveChannel<Route>) {
    val prefs = container.prefs
    val remote = container.remote
    val systemDark = isSystemInDarkTheme()
    val overview by remote.overview.collectAsState()
    val ready by remote.ready.collectAsState()
    val client by remote.client.collectAsState()
    val paired = client != null
    // The desktop's palette, kept in the offline overview so it's there before it connects.
    val appearance = overview?.appearance
    val colors = remember(prefs.themeMode, systemDark, appearance) { resolveColors(prefs.themeMode, appearance?.toDesktop(), systemDark) }
    RelayTheme(colors) {
        SystemBars(dark = colors.isDark)
        val backStack = rememberNavBackStack(Route.Home)
        val top = backStack.lastOrNull() as? Route
        // Panes only once there's a computer to list; pairing is one whole screen.
        val panes = rememberIsWide() && ready && paired && top !is Route.Pair
        val isWide by rememberUpdatedState(panes)
        val navigator = remember(backStack) { AppNavigator(backStack) { isWide } }
        val toasts = remember { ToastState() }
        val sidebar = panes && !prefs.sidebarHidden
        val activity = LocalView.current.context as? Activity

        // A new process (an update, or Android reclaiming the app) gets back the stack the old one
        // saved, pairing screen and all. Nobody means to wake up there: it goes, and comes back
        // below if the phone really has no computer. A fold or unfold keeps the process, and a
        // pairing in progress with it.
        LaunchedEffect(backStack) {
            if (stackRestored) return@LaunchedEffect
            stackRestored = true
            backStack.removeAll { it is Route.Pair }
        }
        LaunchedEffect(navigator) { for (route in links) navigator.open(route) }
        // Decided here, from one composition's reads: inside the effect, `ready` would be read live
        // while `paired` stayed as composed, and a launch that drew before the saved computer was
        // read saw it ready and unpaired at once, and opened pairing over a paired phone.
        val unpaired = ready && !paired && top == Route.Home
        LaunchedEffect(unpaired) {
            if (unpaired) navigator.push(Route.Pair())
        }
        // Home and the sidebar carry their own line; Settings and pairing say it themselves.
        val notice: (@Composable () -> Unit)? =
            if (sidebar || top is Route.Settings || top is Route.Pair || (top == Route.Home && !panes)) null
            else ({ ConnectionLine(remote) })

        val links = rememberTunnelLinks(remote, LocalUriHandler.current, navigator)
        CompositionLocalProvider(
            LocalNavigator provides navigator,
            LocalToasts provides toasts,
            LocalUriHandler provides links,
            LocalOpensLocalhost provides rememberTunnels(remote),
        ) {
            Box(Modifier.fillMaxSize().background(RelayTheme.colors.background)) {
                WideLayout(panes, prefs, sidebar = { HomeSidebar(container) }) {
                    CompositionLocalProvider(LocalScreenNotice provides notice) {
                        NavDisplay(
                            backStack = backStack,
                            // Nothing paired: Home behind pairing is only a redirect, so back leaves the app.
                            onBack = { if (!paired && top is Route.Pair && backStack.size == 2) activity?.finish() else navigator.pop() },
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
                }
                NeedsYou(
                    remote,
                    openId = (top as? Route.Thread)?.id,
                    hidden = sidebar || top == Route.Home,
                    pane = panes,
                    // Below a TopBar.
                    modifier = Modifier.align(Alignment.TopCenter)
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                        .padding(top = 60.dp),
                )
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
