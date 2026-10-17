package dev.relay.android.ui.ribbon

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.pullToRefresh
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.rememberReducedMotion
import dev.relay.android.ui.theme.RelayTheme
import kotlin.math.PI
import kotlin.math.sin

/**
 * Pull to refresh that writes the Relay R: the list moves down to open a gap, and the pull writes
 * the R into it stroke by stroke, finishing exactly where letting go refreshes (with a tick and a
 * glint). While it loads, light runs along the satin; when it's done the gap closes and the R
 * rolls back up the way it was written.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RibbonRefreshBox(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val state = rememberPullToRefreshState()
    val gap = with(LocalDensity.current) { GAP.toPx() }
    val haptics = rememberHaptics()
    val reduced = rememberReducedMotion()
    val onWhite = !RelayTheme.colors.isDark
    val mesh = remember { RibbonMesh() }
    // Seconds since the pull armed the refresh (the glint across the finished R), or -1.
    var armed by remember { mutableFloatStateOf(-1f) }
    var loading by remember { mutableFloatStateOf(0f) }
    var armedAt by remember { mutableLongStateOf(0L) }

    LaunchedEffect(state, refreshing) {
        if (refreshing) return@LaunchedEffect
        snapshotFlow { state.distanceFraction }.collect { f ->
            // Only a finger arms it: the gap also passes 1 when a refresh nobody pulled closes.
            if (f >= 1f && armed < 0f && !state.isAnimating) {
                haptics.perform(Haptic.Light)
                armedAt = withFrameNanos { it }
                armed = 0f
            } else if (f < 0.9f) {
                armed = -1f
            }
        }
    }
    LaunchedEffect(armedAt, reduced) {
        if (armed < 0f || reduced) return@LaunchedEffect
        while (armed in 0f..FLASH) {
            withFrameNanos { armed = (it - armedAt) / 1e9f }
        }
    }
    LaunchedEffect(refreshing, reduced) {
        loading = 0f
        if (!refreshing || reduced) return@LaunchedEffect
        val start = withFrameNanos { it }
        while (true) withFrameNanos { loading = (it - start) / 1e9f }
    }

    Box(modifier.pullToRefresh(refreshing, state, threshold = GAP, onRefresh = onRefresh)) {
        Box(Modifier.fillMaxSize().graphicsLayer { translationY = state.distanceFraction.coerceIn(0f, MAX_PULL) * gap }) {
            content()
        }
        Box(
            Modifier.fillMaxSize().clipToBounds().drawBehind {
                val open = state.distanceFraction.coerceIn(0f, MAX_PULL) * gap
                if (open < 0.5f) return@drawBehind
                val (glintAt, glint) = when {
                    refreshing -> {
                        val x = (loading * 0.75f) % 1.25f / 1.25f
                        (-0.15f + 1.5f * x) to 0.9f
                    }
                    armed in 0f..FLASH -> {
                        val x = armed / FLASH
                        (-0.15f + 1.3f * x) to sin(PI.toFloat() * x)
                    }
                    else -> 0f to 0f
                }
                val p = state.distanceFraction.coerceIn(0f, 1f)
                drawIntoCanvas {
                    it.nativeCanvas.save()
                    it.nativeCanvas.clipRect(0f, 0f, size.width, open)
                    mesh.draw(
                        it.nativeCanvas,
                        size.width / 2,
                        open / 2,
                        R_HEIGHT.toPx(),
                        written = p * p * (3 - 2 * p),
                        glintAt = glintAt,
                        glint = glint,
                        onWhite = onWhite,
                    )
                    it.nativeCanvas.restore()
                }
            },
        )
    }
}

private val GAP = 88.dp
private val R_HEIGHT = 54.dp
private const val MAX_PULL = 1.6f
private const val FLASH = 0.38f
