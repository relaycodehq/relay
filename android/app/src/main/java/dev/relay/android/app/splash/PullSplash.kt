package dev.relay.android.app.splash

import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin

/** Where the ribbon is and what the splash looks like at a moment of the pull. */
internal class PullFrame {
    /** Guide distance of the ribbon's tail; its head is at tail + [PullSplash.span]. */
    var tail = 0.0
    var ribbon = true
    var wake = false
    var backdrop = 1f
    var appScale = PullSplash.APP_SCALE_FROM
    var done = false
}

/**
 * The splash's exit: the R the system splash showed gets its leg yanked, the ribbon unthreads
 * itself out of the R along the guide and whips past the camera, and wherever it has passed the
 * splash is wiped away to the app beneath. Times are seconds since the overlay's first frame.
 */
internal object PullSplash {
    /** World units from the camera to the R; the exit's flight is laid out around it. */
    const val CAMERA_DISTANCE = 40.0

    /**
     * The splash still (splash_mark.png) is [ICON_PX] square and draws one world unit as
     * [UNIT_PX]; android/tools/splash-icon/render.mjs uses the same numbers.
     */
    const val ICON_PX = 1152.0
    const val UNIT_PX = 118.0

    const val APP_SCALE_FROM = 1.045f
    private const val HOLD = 0.06
    /** Stretches the whole pull; 1.0 was the browser prototype's pace, which felt rushed. */
    private const val PACE = 1.3
    private const val PULL = 0.98 * PACE
    const val DURATION = HOLD + 1.06 * PACE

    private fun knot(x: Double, y: Double, z: Double, halfTurns: Double, boost: Double = 1.0) =
        Knot(x, y, z, 0.27, halfTurns * PI, boost)

    private val EXIT = listOf(
        knot(2.0, -2.95, 0.3, 2.0),
        knot(2.6, -4.3, 1.4, 2.4, 1.1),
        knot(4.3, -4.6, 4.5, 3.2, 1.4),
        knot(4.4, -0.8, 9.0, 4.2, 1.8),
        knot(0.6, 3.6, 14.0, 5.2, 2.2),
        knot(-3.4, 1.6, 20.0, 6.2, 2.5),
        knot(-2.4, -2.4, 27.0, 7.0, 2.6),
        knot(0.4, -1.2, 34.0, 7.8, 2.6),
        knot(0.15, 0.1, 40.4, 8.3, 2.6),
        knot(-0.5, 0.9, 48.0, 8.8, 2.6),
        knot(-1.6, 1.8, 62.0, 9.4, 2.6),
        knot(-2.5, 2.4, 76.0, 10.0, 2.6),
    )

    val guide = Guide(RelayR.knots + EXIT, RelayR.ALIGN)

    /** The ribbon's length: the R, from its top tip to the end of its leg. */
    val span = guide.knotArc[RelayR.knots.size - 1]

    /** Past here the ribbon has left the R, and its wake starts wiping the splash. */
    val wakeFrom = span + 1.2

    fun frame(t: Double, out: PullFrame) {
        val q = progress(t, HOLD, HOLD + PULL)
        // A tiny tug back into the knot before the yank.
        val tug = if (q < 0.14) -0.1 * sin(PI * q / 0.14) else 0.0
        out.tail = (guide.length - span) * q.pow(2.7) + tug
        out.ribbon = t < DURATION
        out.wake = t >= HOLD
        out.backdrop = 1f - smooth(t, HOLD + 0.86 * PACE, HOLD + 1.02 * PACE).toFloat()
        val settle = progress(t, HOLD + 0.36 * PACE, DURATION)
        out.appScale = APP_SCALE_FROM - (APP_SCALE_FROM - 1f) * (1 - (1 - settle).pow(3)).toFloat()
        out.done = t >= DURATION
    }

    private fun progress(t: Double, a: Double, b: Double) = ((t - a) / (b - a)).coerceIn(0.0, 1.0)

    private fun smooth(t: Double, a: Double, b: Double): Double {
        val x = progress(t, a, b)
        return x * x * (3 - 2 * x)
    }
}
