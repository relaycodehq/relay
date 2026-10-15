package dev.relay.android.features.images

import kotlin.math.max
import kotlin.math.min

/** How far an image may move off centre each way. */
data class PanLimits(val x: Float, val y: Float)

/**
 * Pan limits for an image (width over height [ratio], 0 while unknown)
 * contained in a [width] × [height] page, then zoomed about its centre.
 */
fun imageLimits(ratio: Float, width: Float, height: Float, scale: Float): PanLimits {
    val fitted = if (ratio != 0f) min(width, height * ratio) else width
    return PanLimits(
        x = max(0f, (fitted * scale - width) / 2),
        y = max(0f, ((if (ratio != 0f) fitted / ratio else height) * scale - height) / 2),
    )
}
