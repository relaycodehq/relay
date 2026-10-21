package dev.relay.android.ui

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect

/** The layout every screen's shared elements meet in, or null where nothing travels. */
@OptIn(ExperimentalSharedTransitionApi::class)
val LocalSharedTransitions = staticCompositionLocalOf<SharedTransitionScope?> { null }

/** The screen's own enter/exit, so its elements can follow the navigation's transition. */
val LocalScreenAnimation = compositionLocalOf<AnimatedVisibilityScope?> { null }

/** A touch underdamped: the button lands with a small settle instead of stopping dead. */
@OptIn(ExperimentalSharedTransitionApi::class)
private val flight = BoundsTransform { _: Rect, _: Rect ->
    spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow, visibilityThreshold = Rect.VisibilityThreshold)
}

/**
 * A button that flies from one screen into a button on the next, scaling as it goes. Put it on
 * both with the same [key]; draw both alike (shape, fill, icon) and the hand-over can't be seen.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.sharedButton(key: Any): Modifier {
    val shared = LocalSharedTransitions.current ?: return this
    val screen = LocalScreenAnimation.current ?: return this
    return with(shared) {
        this@sharedButton.sharedBounds(
            rememberSharedContentState(key),
            screen,
            enter = fadeIn(tween(160)),
            exit = fadeOut(tween(160)),
            boundsTransform = flight,
            resizeMode = SharedTransitionScope.ResizeMode.scaleToBounds(),
        )
    }
}

/**
 * Whether the screen has finished coming in. A flying button aims where its target was when it
 * took off, so anything that moves the target (the keyboard) waits for this.
 */
@Composable
fun screenSettled(): Boolean {
    val transition = LocalScreenAnimation.current?.transition ?: return true
    return transition.currentState == EnterExitState.Visible && transition.targetState == EnterExitState.Visible
}
