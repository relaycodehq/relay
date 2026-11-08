package dev.relay.android.features.images

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.animation.core.tween
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.lerp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs

private const val MAX_SCALE = 5f
private const val TAP_SCALE = 2.5f

/** Screen-space transforms; touch updates synchronously and interrupts any settling animation. */
internal class LightboxTransform {
    var scale by mutableFloatStateOf(1f)
        private set

    var offset by mutableStateOf(Offset.Zero)
        private set

    val zoomed by derivedStateOf { scale > 1.01f }

    private var ratio = 0f
    private var centre = Offset.Zero
    private var animation: Job? = null

    fun resize(ratio: Float, width: Float, height: Float) {
        stop()
        this.ratio = ratio
        centre = Offset(width / 2, height / 2)
        scale = scale.coerceIn(1f, MAX_SCALE)
        offset = bounded(offset, scale)
    }

    fun stop() {
        animation?.cancel()
        animation = null
    }

    fun reset() {
        stop()
        scale = 1f
        offset = Offset.Zero
    }

    fun pinch(zoom: Float, pan: Offset, centroid: Offset) {
        val next = (scale * zoom).coerceIn(0.8f, MAX_SCALE)
        val focus = centroid - centre
        offset = bounded(focus - (focus - offset) * (next / scale) + pan, next)
        scale = next
    }

    fun canPan(delta: Offset): Boolean {
        if (!zoomed) return false
        if (abs(delta.y) > abs(delta.x)) return true
        val edge = limits(scale).x
        val roomToRight = delta.x > 0 && offset.x < edge - 0.5f
        val roomToLeft = delta.x < 0 && offset.x > -edge + 0.5f
        return roomToRight || roomToLeft
    }

    fun pan(delta: Offset) {
        offset = bounded(offset + delta, scale)
    }

    fun settle(scope: CoroutineScope) {
        val next = scale.coerceIn(1f, MAX_SCALE)
        animateTo(scope, next, bounded(offset, next))
    }

    fun doubleTap(scope: CoroutineScope, at: Offset) {
        if (zoomed) animateTo(scope, 1f, Offset.Zero)
        else animateTo(scope, TAP_SCALE, bounded((centre - at) * (TAP_SCALE - 1), TAP_SCALE))
    }

    fun fling(scope: CoroutineScope, velocity: Offset) {
        stop()
        val edge = limits(scale)
        animation = scope.launch {
            val motion = Animatable(offset, Offset.VectorConverter)
            motion.updateBounds(Offset(-edge.x, -edge.y), Offset(edge.x, edge.y))
            motion.animateDecay(velocity, exponentialDecay()) { offset = value }
        }
    }

    private fun animateTo(scope: CoroutineScope, next: Float, to: Offset) {
        stop()
        val fromScale = scale
        val fromOffset = offset
        animation = scope.launch {
            Animatable(0f).animateTo(1f, tween(200)) {
                scale = fromScale + (next - fromScale) * value
                offset = bounded(lerp(fromOffset, to, value), scale)
            }
        }
    }

    private fun limits(scale: Float) = imageLimits(ratio, centre.x * 2, centre.y * 2, scale)

    private fun bounded(at: Offset, scale: Float): Offset {
        val edge = limits(scale)
        return Offset(at.x.coerceIn(-edge.x, edge.x), at.y.coerceIn(-edge.y, edge.y))
    }
}
