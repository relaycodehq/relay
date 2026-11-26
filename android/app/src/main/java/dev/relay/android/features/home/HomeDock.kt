package dev.relay.android.features.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.add
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.BarGlyph
import dev.relay.android.ui.BarTab
import dev.relay.android.ui.BottomBar
import dev.relay.android.ui.LocalTakesTaps
import dev.relay.android.ui.theme.RelayTheme

enum class HomeTab { Threads, Projects, Pulls }

/** The bar's 56dp and the room around it. */
private val BAR_ROOM = 64.dp

/** Over the composer (or the bar) the list fades out; from there down the dock is solid. */
internal val DOCK_FADE = 28.dp

/** Between the composer and what's under it: the bar, or the keyboard. */
private val COMPOSER_GAP = 8.dp

/** The composer and the bar under it share their edges, and span the list like the thread's composer does. */
private fun Modifier.dockWidth() = fillMaxWidth().padding(horizontal = 15.dp)

internal fun homeTabs(threadsNews: Boolean) = listOf(
    BarTab(HomeTab.Threads, BarGlyph.Threads, "Threads", dot = threadsNews),
    BarTab(HomeTab.Projects, BarGlyph.Projects, "Projects"),
    BarTab(HomeTab.Pulls, BarGlyph.Pulls, "PRs", "Pull requests"),
)

/**
 * What floats over a home page: the [composer] on the tabs that have one, and the bar of tabs.
 * The bar stays where it is and the keyboard comes up over it; the composer rides up with the
 * keyboard once that's higher than the bar.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HomeDock(
    tab: HomeTab,
    onTab: (HomeTab) -> Unit,
    /** False beside the detail, whose keyboard it is. */
    followsKeyboard: Boolean,
    threadsNews: Boolean,
    /** How much the dock covers above the system's bar, its fade left out. */
    onHeight: (Dp) -> Unit,
    modifier: Modifier = Modifier,
    hasComposer: Boolean,
    composer: @Composable () -> Unit,
) {
    val surface = RelayTheme.colors.surface
    val density = LocalDensity.current
    var composerHeight by remember { mutableStateOf(0.dp) }
    val height = composerHeight + BAR_ROOM
    LaunchedEffect(height) { onHeight(height) }
    val underBar = WindowInsets.navigationBars.add(WindowInsets(bottom = BAR_ROOM))
    val under = if (followsKeyboard) WindowInsets.ime.union(underBar) else underBar
    Box(modifier.fillMaxWidth()) {
        Box(
            Modifier.matchParentSize().background(
                Brush.verticalGradient(listOf(surface.copy(alpha = 0f), surface), endY = with(density) { DOCK_FADE.toPx() }),
            ),
        )
        Column(Modifier.fillMaxWidth().padding(top = DOCK_FADE), horizontalAlignment = Alignment.CenterHorizontally) {
            val motion = RelayTheme.motion.standard
            AnimatedVisibility(
                hasComposer,
                Modifier.onSizeChanged { composerHeight = with(density) { it.height.toDp() } },
                enter = fadeIn(motion.defaultEffectsSpec()) + expandVertically(motion.defaultSpatialSpec(), clip = false),
                exit = fadeOut(motion.fastEffectsSpec()) + shrinkVertically(motion.defaultSpatialSpec(), clip = false),
            ) {
                Box(
                    Modifier.dockWidth().padding(bottom = COMPOSER_GAP)
                        // This dock already stands on the keyboard.
                        .consumeWindowInsets(WindowInsets.ime.union(WindowInsets.navigationBars)),
                ) { CompositionLocalProvider(LocalTakesTaps provides hasComposer) { composer() } }
            }
            Spacer(Modifier.windowInsetsBottomHeight(under))
        }
        AnimatedVisibility(
            !(followsKeyboard && WindowInsets.isImeVisible),
            Modifier.align(Alignment.BottomCenter),
            enter = fadeIn(RelayTheme.motion.standard.fastEffectsSpec()),
            exit = fadeOut(RelayTheme.motion.standard.fastEffectsSpec()),
        ) {
            BottomBar(
                homeTabs(threadsNews), tab, onTab,
                Modifier.navigationBarsPadding().dockWidth().padding(vertical = 4.dp),
            )
        }
    }
}
