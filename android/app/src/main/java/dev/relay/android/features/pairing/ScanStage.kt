package dev.relay.android.features.pairing

import android.annotation.SuppressLint
import android.content.Context
import android.opengl.GLSurfaceView
import android.util.Size
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.relay.android.ui.theme.RelayTheme
import kotlin.math.hypot
import kotlin.math.min

/** The field, with the camera under it while scanning, both drawn in one GL pass from one clock. */
@Composable
fun ScanStage(scan: PairingScan, cameraFailed: (String) -> Unit, modifier: Modifier = Modifier) {
    val lifecycle = LocalLifecycleOwner.current
    val palette = ripplePalette()
    AndroidView(
        factory = { FieldView(it, scan, palette, lifecycle) },
        modifier = modifier,
        update = {
            it.renderer.palette = palette
            it.cameraFailed = cameraFailed
        },
    )
}

/**
 * The field in Relay's own colours, as the iPhone's: the desktop's default "relay" theme's muted
 * and violet accent, over this app's background.
 */
@Composable
private fun ripplePalette(): RipplePalette {
    val c = RelayTheme.colors
    val dark = c.isDark
    return remember(dark, c.background) {
        val accent = rgb(if (dark) 0xAAA8E5 else 0x6565A9)
        RipplePalette(
            base = rgb(if (dark) 0x94949F else 0x676972),
            hot = accent,
            // Over the camera it's always dark, so a light theme's deep accent goes paler there.
            overCamera = if (dark) accent else FloatArray(3) { accent[it] + (1 - accent[it]) * 0.45f },
            baseAlpha = if (dark) 0.28f else 0.34f,
            light = !dark,
            background = c.background.let { floatArrayOf(it.red, it.green, it.blue) },
        )
    }
}

private fun rgb(hex: Int) = Color(0xFF000000.toInt() or hex).let { floatArrayOf(it.red, it.green, it.blue) }

@SuppressLint("ViewConstructor")
class FieldView(
    context: Context,
    private val scan: PairingScan,
    palette: RipplePalette,
    private val owner: LifecycleOwner,
) : GLSurfaceView(context), DefaultLifecycleObserver {
    val renderer = FieldRenderer(palette)
    /** The camera can't be used: no permission, or it wouldn't start. */
    var cameraFailed: (String) -> Unit = {}
    @Volatile private var camera: CodeCamera? = null
    private var last = 0L
    private var clock = 0.0
    /** Where a dragging finger last left a ring. */
    private var dragged: Pair<Float, Float>? = null

    init {
        setEGLContextClientVersion(3)
        setEGLConfigChooser(8, 8, 8, 8, 0, 0)
        preserveEGLContextOnPause = true
        renderer.setDensity(resources.displayMetrics.density)
        renderer.frame = { tick() }
        setRenderer(renderer)
        renderMode = RENDERMODE_CONTINUOUSLY
    }

    // Endless, so it stops whenever the app isn't in front.
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        owner.lifecycle.addObserver(this)
    }

    override fun onDetachedFromWindow() {
        owner.lifecycle.removeObserver(this)
        dropCamera()
        queueEvent { renderer.release() }
        super.onDetachedFromWindow()
    }

    override fun onResume(owner: LifecycleOwner) {
        last = 0
        onResume()
    }

    override fun onPause(owner: LifecycleOwner) {
        onPause()
        dropCamera()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        camera?.stage = Size(w, h)
    }

    /** A finger on the field makes its own rings: one where it touches, smaller ones as it drags. */
    private val touchable: Boolean
        get() = !scan.reduceMotion && scan.phase in setOf(
            PairingScan.Phase.Idle, PairingScan.Phase.Waiting, PairingScan.Phase.Answering, PairingScan.Phase.Paired,
        )

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!touchable) {
            dragged = null
            return false
        }
        val x = event.x
        val y = event.y
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragged = x to y
                queueEvent {
                    if (renderer.touch(x, y, 1f)) post { performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
                }
            }
            MotionEvent.ACTION_MOVE -> {
                val from = dragged ?: return true
                if (hypot(x - from.first, y - from.second) > 28 * resources.displayMetrics.density) {
                    dragged = x to y
                    queueEvent { renderer.touch(x, y, 0.5f) }
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragged = null
        }
        return true
    }

    /** On the GL thread, once a frame. */
    private fun tick(): RippleFrame {
        val now = System.nanoTime()
        val dt = if (last == 0L) 1.0 / 60 else min(0.05, (now - last) / 1e9)
        last = now
        if (!scan.reduceMotion) clock += dt
        scan.advance(dt)
        val wants = scan.wantsCamera
        if (wants != (camera != null)) post {
            if (scan.wantsCamera && camera == null) startCamera()
            if (!scan.wantsCamera && camera != null) dropCamera()
        }
        val picture = wants && renderer.pictures > 0
        scan.cameraLive = picture
        val density = resources.displayMetrics.density
        val points = Vec2(width / density, height / density)
        return RippleFrame(clock, scan.scene(points), scan.code?.size ?: 0, scan.takeAnswer(), picture)
    }

    private fun startCamera() {
        val texture = renderer.cameraTexture ?: return
        renderer.pictures = 0
        val camera = CodeCamera(context, owner, texture) { renderer.pictureLayout = it }
        camera.onSeen = { code, corners ->
            scan.seen(code, corners.map(::ndc)).also { if (it) renderer.modules = code.modules }
        }
        camera.onMoved = { corners -> scan.moved(corners.map(::ndc)) }
        camera.onFailed = {
            dropCamera()
            scan.close()
            cameraFailed("The camera didn't start. Paste the pairing link instead.")
        }
        camera.stage = Size(width, height)
        camera.start()
        this.camera = camera
    }

    private fun dropCamera() {
        camera?.stop()
        camera = null
        renderer.pictures = 0
    }

    private fun ndc(p: Vec2) = Vec2(p.x / width * 2 - 1, 1 - p.y / height * 2)
}
