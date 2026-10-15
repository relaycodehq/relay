package dev.relay.android.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Hexta's --radius (0.8rem = 12.8) and its steps. Nested corners: outer minus inset. */
@Immutable
object Radii {
    val sm = 7.7.dp
    val md = 10.2.dp
    val lg = 12.8.dp
    val xl = 17.9.dp
    val xxl = 23.dp

    val smShape = RoundedCornerShape(sm)
    val mdShape = RoundedCornerShape(md)
    val lgShape = RoundedCornerShape(lg)
    val xlShape = RoundedCornerShape(xl)
    val xxlShape = RoundedCornerShape(xxl)
}

/** Tailwind's 4dp grid. */
@Immutable
object Space {
    val px1 = 2.dp
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val xxxl = 48.dp
}

object Motion {
    /** ease-out-quint: most things. */
    val EaseOutQuint = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
    /** The drawer's curve. */
    val Drawer = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
    const val FAST = 150
    const val BASE = 200
    const val SLIDE = 300
}

/** One physical pixel, the width of every Hexta border. */
fun hairline(density: Float): Dp = (1f / density).dp
