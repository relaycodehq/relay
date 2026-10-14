package dev.relay.android.features.thread

import androidx.compose.animation.core.LinearEasing
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.Remote
import dev.relay.android.ui.Text
import dev.relay.android.ui.loop
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.delay

/** The remote the thread's rows ask for whole outputs, pictures and peeks. */
val LocalThreadRemote = staticCompositionLocalOf<Remote?> { null }

/** The wall clock, stepped every [ms] while the app is in front. */
@Composable
fun rememberNow(ms: Long): Long {
    val inFront by rememberInFront()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(ms, inFront) {
        while (inFront) {
            now = System.currentTimeMillis()
            delay(ms - now % ms)
        }
    }
    return now
}

/** The live label's sweep (the desktop's `.live-shine`), drawn on its own layer so it never recomposes. */
@Composable
fun Modifier.shine(): Modifier {
    val p = loop(1800, LinearEasing, -0.4f, 1.4f, still = -1f, showsWork = true)
    val glint = RelayTheme.colors.foreground
    return graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen).drawWithContent {
        drawContent()
        val x = p()
        if (x < -0.5f) return@drawWithContent
        val w = size.width
        drawRect(
            Brush.horizontalGradient(
                0f to Color.Transparent,
                0.5f to glint.copy(alpha = 0.9f),
                1f to Color.Transparent,
                startX = (x - 0.25f) * w,
                endX = (x + 0.25f) * w,
            ),
            blendMode = BlendMode.SrcAtop,
        )
    }
}

@Composable
fun ShineText(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.shine(), style = RelayTheme.type.sm, color = RelayTheme.colors.mutedForeground, maxLines = 1)
}

// The frames of the desktop's .thinking-glyph (src/features/agent-turn/agent-trace.css).
private val ASTERISK = "·✢✳✶✻✽✻✶✳✢".map { it.toString() } to 150
private val BRAILLE = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".map { it.toString() } to 80

/** Claude's turning asterisk, or a terminal braille spinner for every other agent; drawn, not recomposed. */
@Composable
fun ThinkingGlyph(provider: String, modifier: Modifier = Modifier) {
    val (frames, ms) = if (provider == "claude") ASTERISK else BRAILLE
    val still = if (provider == "claude") 2f else 0f
    val at = loop(frames.size * ms, LinearEasing, 0f, frames.size.toFloat(), still = still, showsWork = true)
    val measurer = rememberTextMeasurer()
    val style = RelayTheme.type.sm.copy(color = RelayTheme.colors.accent)
    Box(
        modifier.size(14.dp).drawBehind {
            val frame = frames[at().toInt().coerceIn(0, frames.size - 1)]
            val laid = measurer.measure(frame, style)
            drawText(laid, topLeft = Offset((size.width - laid.size.width) / 2f, (size.height - laid.size.height) / 2f))
        },
    )
}
