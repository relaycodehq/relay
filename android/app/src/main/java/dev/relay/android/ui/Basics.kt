package dev.relay.android.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import androidx.compose.material3.Icon as MaterialIcon
import androidx.compose.material3.Text as MaterialText

/** Text in the theme's type and colour; 13sp body by default. */
@Composable
fun Text(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = RelayTheme.type.sm,
    color: Color = RelayTheme.colors.foreground,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Ellipsis,
    textAlign: TextAlign? = null,
) {
    MaterialText(
        text = text,
        modifier = modifier,
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = overflow,
        textAlign = textAlign,
    )
}

/** A Tabler icon at Hexta's 16dp, tinted with the current content colour. */
@Composable
fun Icon(
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
    size: Dp = 16.dp,
) {
    MaterialIcon(icon, contentDescription, modifier.size(size), tint = tint)
}

/** Sets the colour icons and text inside take by default. */
@Composable
fun ContentColor(color: Color, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalContentColor provides color, content = content)
}

/** A one-pixel rule. */
@Composable
fun Divider(
    modifier: Modifier = Modifier,
    color: Color = RelayTheme.colors.border,
    vertical: Boolean = false,
) {
    val w = RelayTheme.hairline
    Box(
        modifier
            .then(if (vertical) Modifier.fillMaxHeight().width(w) else Modifier.fillMaxWidth().height(w))
            .background(color),
    )
}

/** An arc going round; it holds still while the app isn't in front. */
@Composable
fun Spinner(
    modifier: Modifier = Modifier,
    size: Dp = 16.dp,
    color: Color = LocalContentColor.current,
    stroke: Dp = 1.75.dp,
) {
    val angle = loop(800, LinearEasing, 0f, 360f, showsWork = true)
    Canvas(modifier.size(size)) {
        val w = stroke.toPx()
        val a = angle()
        drawArc(color.copy(alpha = 0.2f), 0f, 360f, false, style = Stroke(w))
        rotate(a) {
            drawArc(color, -90f, 100f, false, style = Stroke(w, cap = StrokeCap.Round))
        }
    }
}

/** A thin bar: `progress` 0..1, or a sliding band when null. */
@Composable
fun ProgressBar(
    progress: Float?,
    modifier: Modifier = Modifier,
    color: Color = RelayTheme.colors.foreground,
    height: Dp = 3.dp,
) {
    val track = RelayTheme.colors.muted
    val shape = RoundedCornerShape(height)
    if (progress != null) {
        val shown by animateFloatAsState(progress.coerceIn(0f, 1f), tween(Motion.SLIDE, easing = Motion.EaseOutQuint), label = "progress")
        Box(modifier.fillMaxWidth().height(height).clip(shape).background(track)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(shown).clip(shape).background(color))
        }
        return
    }
    val x = loop(1200, Motion.EaseOutQuint, -0.4f, 1f, still = 0.3f, showsWork = true)
    Box(
        modifier.fillMaxWidth().height(height).clip(shape).background(track).drawWithContent {
            val start = x() * size.width
            drawRect(color, Offset(start, 0f), androidx.compose.ui.geometry.Size(size.width * 0.4f, size.height))
        },
    )
}

/** A placeholder block: muted fill with a band sweeping across every 1.6s while in front. */
@Composable
fun Skeleton(
    modifier: Modifier = Modifier,
    shape: Shape = Radii.mdShape,
) {
    val c = RelayTheme.colors
    val band = c.foreground.copy(alpha = if (c.isDark) 0.10f else 0.08f)
    val p = loop(1600, LinearEasing, 0f, 1f, still = -1f)
    Box(
        modifier.clip(shape).background(c.muted).drawWithContent {
            val at = p()
            if (at < 0f) return@drawWithContent
            val w = size.width
            val x = -w + at * 2 * w
            drawRect(
                Brush.horizontalGradient(
                    listOf(Color.Transparent, band, Color.Transparent),
                    startX = x,
                    endX = x + w,
                ),
            )
        },
    )
}

/**
 * An endless 0..1-style value read at draw time, so it never recomposes. It
 * only runs while the app is in front and animations are on; otherwise it
 * holds at `still`. `showsWork` loops (spinners) keep going under reduced motion.
 */
@Composable
fun loop(durationMs: Int, easing: androidx.compose.animation.core.Easing, from: Float, to: Float, still: Float = from, showsWork: Boolean = false): () -> Float {
    val inFront by rememberInFront()
    val reduced = rememberReducedMotion()
    if (!inFront || (reduced && !showsWork)) return { still }
    val t = rememberInfiniteTransition(label = "loop")
    val v = t.animateFloat(from, to, infiniteRepeatable(tween(durationMs, easing = easing), RepeatMode.Restart), label = "loop")
    return { v.value }
}
