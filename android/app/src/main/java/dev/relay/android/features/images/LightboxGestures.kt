package dev.relay.android.features.images

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.util.VelocityTracker
import kotlinx.coroutines.coroutineScope

/** Decide once per drag; a second finger always takes ownership until every finger is up. */
internal suspend fun PointerInputScope.detectLightboxGestures(
    transform: LightboxTransform,
    onPinchStart: () -> Unit,
) = coroutineScope {
    val scope = this
    awaitEachGesture {
        // Intercept before the tap detector and pager can consume a pinch's first movement.
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        transform.stop()
        val tracker = VelocityTracker()
        tracker.addPosition(down.uptimeMillis, down.position)
        var pinched = false
        var dragging = false
        var paging = false
        do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val pressed = event.changes.count { it.pressed }
            if (pressed >= 2) {
                if (!pinched) onPinchStart()
                pinched = true
                val centroid = event.calculateCentroid(useCurrent = false)
                if (centroid != Offset.Unspecified) {
                    transform.pinch(event.calculateZoom(), event.calculatePan(), centroid)
                }
            } else if (pinched) {
                transform.pan(event.calculatePan())
            } else {
                val change = event.changes.first()
                val delta = change.position - down.position
                if (!dragging && !paging && delta.getDistance() > viewConfiguration.touchSlop) {
                    dragging = transform.canPan(delta)
                    paging = !dragging
                }
                if (dragging) {
                    tracker.addPosition(change.uptimeMillis, change.position)
                    transform.pan(event.calculatePan())
                }
            }
            // Includes the one-finger tail and up events. The pager must never pick a pinch back up.
            if (pinched || dragging) event.changes.forEach { it.consume() }
        } while (event.changes.any { it.pressed })
        if (pinched) transform.settle(scope)
        else if (dragging) {
            val velocity = tracker.calculateVelocity()
            transform.fling(scope, Offset(velocity.x, velocity.y))
        }
    }
}
