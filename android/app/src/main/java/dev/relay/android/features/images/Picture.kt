package dev.relay.android.features.images

import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.RememberObserver
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.painter.Painter
import java.nio.ByteBuffer
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * What draws a loaded picture: a GIF plays, anything else is its bitmap. Until
 * the GIF's drawable is ready, its first frame stands in, so nothing jumps.
 */
@Composable
fun rememberPicture(loaded: LoadedImage): Painter? {
    val bitmap = loaded.bitmap ?: return null
    val still = remember(bitmap) { BitmapPainter(bitmap) }
    val animation = loaded.animation ?: return still
    val drawable by produceState<AnimatedImageDrawable?>(null, animation) {
        value = withContext(Dispatchers.Default) {
            runCatching {
                ImageDecoder.decodeDrawable(ImageDecoder.createSource(ByteBuffer.wrap(animation.bytes)))
            }.getOrNull() as? AnimatedImageDrawable
        }
    }
    // Each place gets its own drawable: one drawable has room for only one callback to redraw.
    return drawable?.let { remember(it) { AnimationPainter(it) } } ?: still
}

/** Plays an animated drawable while it's on screen; scrolled away, it stops. */
private class AnimationPainter(private val drawable: AnimatedImageDrawable) : Painter(), RememberObserver {
    private var frame by mutableIntStateOf(0)
    private val main = Handler(Looper.getMainLooper())

    private val callback = object : Drawable.Callback {
        override fun invalidateDrawable(who: Drawable) {
            frame++
        }

        override fun scheduleDrawable(who: Drawable, what: Runnable, `when`: Long) {
            main.postAtTime(what, `when`)
        }

        override fun unscheduleDrawable(who: Drawable, what: Runnable) {
            main.removeCallbacks(what)
        }
    }

    override val intrinsicSize = Size(drawable.intrinsicWidth.toFloat(), drawable.intrinsicHeight.toFloat())

    override fun onRemembered() {
        drawable.callback = callback
        drawable.start()
    }

    override fun onForgotten() = stop()

    override fun onAbandoned() = stop()

    private fun stop() {
        drawable.stop()
        drawable.callback = null
        main.removeCallbacksAndMessages(null)
    }

    override fun DrawScope.onDraw() {
        frame // read, so each new frame draws again
        drawIntoCanvas { canvas ->
            drawable.setBounds(0, 0, size.width.roundToInt(), size.height.roundToInt())
            drawable.draw(canvas.nativeCanvas)
        }
    }
}
