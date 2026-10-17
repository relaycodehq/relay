package dev.relay.android.app.splash

import android.content.Context
import android.opengl.GLES30
import android.opengl.GLSurfaceView
import dev.relay.android.R
import dev.relay.android.ui.ribbon.GuideSample
import dev.relay.android.ui.ribbon.RelayR
import dev.relay.android.ui.ribbon.cross
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.cos
import kotlin.math.sin

/** Where the system splash drew its icon, in the overlay's pixels. */
internal class IconSpot(val centerX: Float, val centerY: Float, val size: Float)

/**
 * Draws the pull on the GL thread. Its first frames are the still the system splash showed, to
 * the pixel, so the system splash can be taken away under it unseen; [onCovering] says when.
 */
internal class SplashRenderer(
    private val context: Context,
    private val background: FloatArray,
    private val icon: IconSpot,
    private val timeScale: Float,
    private val onCovering: () -> Unit,
    private val onFrame: (PullFrame) -> Unit,
    private val onFailed: () -> Unit,
) : GLSurfaceView.Renderer {
    private var failed = false
    private var ribbonProgram = 0
    private var backdropProgram = 0
    private var buffer = 0
    private var vao = 0
    private var maskTexture = 0
    private var maskFramebuffer = 0
    private var maskWidth = 1
    private var maskHeight = 1
    private var width = 1
    private var height = 1
    private var viewProjection = FloatArray(16)
    private val vertices: FloatBuffer =
        ByteBuffer.allocateDirect(SAMPLES * 2 * FLOATS * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
    private val sample = GuideSample()
    private val frame = PullFrame()
    private var frames = 0
    private var startNanos = 0L

    // A splash that can't draw must give way to the app, not take it down.
    private inline fun guarded(block: () -> Unit) {
        if (failed) return
        try {
            block()
        } catch (e: RuntimeException) {
            failed = true
            android.util.Log.w("RelaySplash", "Splash pull failed", e)
            onFailed()
        }
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) = guarded {
        ribbonProgram = program(R.raw.splash_ribbon_vs, R.raw.splash_ribbon_fs)
        backdropProgram = program(R.raw.splash_backdrop_vs, R.raw.splash_backdrop_fs)
        val ids = IntArray(1)
        GLES30.glGenBuffers(1, ids, 0)
        buffer = ids[0]
        GLES30.glGenVertexArrays(1, ids, 0)
        vao = ids[0]
        GLES30.glBindVertexArray(vao)
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, buffer)
        for ((location, size, offset) in ATTRIBUTES) {
            GLES30.glEnableVertexAttribArray(location)
            GLES30.glVertexAttribPointer(location, size, GLES30.GL_FLOAT, false, FLOATS * 4, offset * 4)
        }
        GLES30.glBindVertexArray(0)
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) = guarded {
        width = w
        height = h
        viewProjection = viewProjection(w, h, icon)
        maskWidth = maxOf(1, w / 2)
        maskHeight = maxOf(1, h / 2)
        val ids = IntArray(1)
        GLES30.glGenTextures(1, ids, 0)
        maskTexture = ids[0]
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, maskTexture)
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, maskWidth, maskHeight, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null)
        for (param in intArrayOf(GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_TEXTURE_MAG_FILTER)) {
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, param, GLES30.GL_LINEAR)
        }
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glGenFramebuffers(1, ids, 0)
        maskFramebuffer = ids[0]
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, maskFramebuffer)
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, maskTexture, 0)
        GLES30.glClearColor(0f, 0f, 0f, 0f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
    }

    override fun onDrawFrame(gl: GL10?) = guarded {
        // The still for two frames, so it is on screen before the system splash goes.
        frames++
        if (frames == 2) onCovering()
        if (frames == 3) startNanos = System.nanoTime()
        val t = if (frames < 3) 0.0 else (System.nanoTime() - startNanos) / 1e9 / timeScale.coerceAtLeast(0.05f)
        PullSplash.frame(t, frame)

        if (frame.ribbon && frame.wake) {
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, maskFramebuffer)
            GLES30.glViewport(0, 0, maskWidth, maskHeight)
            val count = build(frame.tail, WAKE_SAMPLES, WAKE_WIDTH)
            GLES30.glDisable(GLES30.GL_DEPTH_TEST)
            GLES30.glEnable(GLES30.GL_BLEND)
            GLES30.glBlendEquation(GLES30.GL_MAX)
            GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE)
            drawRibbon(count, mode = 1)
            GLES30.glDisable(GLES30.GL_BLEND)
            GLES30.glBlendEquation(GLES30.GL_FUNC_ADD)
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
        }

        GLES30.glViewport(0, 0, width, height)
        GLES30.glClearColor(0f, 0f, 0f, 0f)
        GLES30.glClearDepthf(1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)
        drawBackdrop(frame.backdrop)
        if (frame.ribbon) {
            val count = build(frame.tail, SAMPLES, 1.0)
            GLES30.glEnable(GLES30.GL_DEPTH_TEST)
            GLES30.glDepthFunc(GLES30.GL_LEQUAL)
            drawRibbon(count, mode = 0)
            GLES30.glDisable(GLES30.GL_DEPTH_TEST)
        }
        onFrame(frame)
    }

    private fun drawBackdrop(alpha: Float) {
        val p = backdropProgram
        GLES30.glUseProgram(p)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(p, "uBg"), 1, background, 0)
        GLES30.glUniform1f(GLES30.glGetUniformLocation(p, "uAlpha"), alpha)
        GLES30.glUniform2f(GLES30.glGetUniformLocation(p, "uRes"), width.toFloat(), height.toFloat())
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, maskTexture)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(p, "uMask"), 0)
        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE_MINUS_SRC_ALPHA)
        GLES30.glBindVertexArray(0)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3)
        GLES30.glDisable(GLES30.GL_BLEND)
    }

    private fun drawRibbon(count: Int, mode: Int) {
        val p = ribbonProgram
        GLES30.glUseProgram(p)
        GLES30.glUniformMatrix4fv(GLES30.glGetUniformLocation(p, "uVP"), 1, false, viewProjection, 0)
        GLES30.glUniform3f(GLES30.glGetUniformLocation(p, "uCam"), 0f, 0f, PullSplash.CAMERA_DISTANCE.toFloat())
        GLES30.glUniform1f(GLES30.glGetUniformLocation(p, "uSpan"), PullSplash.span.toFloat())
        GLES30.glUniform1i(GLES30.glGetUniformLocation(p, "uLightBg"), if (background[0] > 0.5f) 1 else 0)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(p, "uMode"), mode)
        GLES30.glBindVertexArray(vao)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, count)
        GLES30.glBindVertexArray(0)
    }

    /** Fills the strip for the ribbon whose tail is at [tail]; [scale] widens it (the wake is wide). */
    private fun build(tail: Double, samples: Int, scale: Double): Int {
        val guide = PullSplash.guide
        val span = PullSplash.span
        val widths = if (samples == SAMPLES) mainWidths else wakeWidths
        val wakeFrom = PullSplash.wakeFrom
        val out = vertices
        out.clear()
        val g = sample
        for (i in 0 until samples) {
            val s = i.toDouble() / (samples - 1)
            val u = tail + s * span
            guide.sample(u, g)
            val w = widths[i] * scale * g.boost
            val t = g.t
            val b = g.b
            val n0 = cross(t, b)
            val c = cos(g.twist)
            val sn = sin(g.twist)
            val wx = b[0] * c + n0[0] * sn
            val wy = b[1] * c + n0[1] * sn
            val wz = b[2] * c + n0[2] * sn
            val nx = t[1] * wz - t[2] * wy
            val ny = t[2] * wx - t[0] * wz
            val nz = t[0] * wy - t[1] * wx
            val x = ((u - wakeFrom) / 2.5).coerceIn(0.0, 1.0)
            val wake = x * x * (3 - 2 * x)
            for (side in 0..1) {
                val k = (side - 0.5) * w
                out.put((g.p[0] + wx * k).toFloat()).put((g.p[1] + wy * k).toFloat()).put((g.p[2] + wz * k).toFloat())
                out.put(nx.toFloat()).put(ny.toFloat()).put(nz.toFloat())
                out.put(t[0].toFloat()).put(t[1].toFloat()).put(t[2].toFloat())
                out.put(s.toFloat()).put(side.toFloat()).put(wake.toFloat()).put(w.toFloat())
            }
        }
        out.flip()
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, buffer)
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, out.limit() * 4, out, GLES30.GL_DYNAMIC_DRAW)
        return samples * 2
    }

    private fun program(vertex: Int, fragment: Int): Int {
        val p = GLES30.glCreateProgram()
        for ((type, res) in listOf(GLES30.GL_VERTEX_SHADER to vertex, GLES30.GL_FRAGMENT_SHADER to fragment)) {
            val shader = GLES30.glCreateShader(type)
            GLES30.glShaderSource(shader, context.resources.openRawResource(res).bufferedReader().use { it.readText() })
            GLES30.glCompileShader(shader)
            val ok = IntArray(1)
            GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, ok, 0)
            check(ok[0] != 0) { "Splash shader: ${GLES30.glGetShaderInfoLog(shader)}" }
            GLES30.glAttachShader(p, shader)
        }
        GLES30.glLinkProgram(p)
        val ok = IntArray(1)
        GLES30.glGetProgramiv(p, GLES30.GL_LINK_STATUS, ok, 0)
        check(ok[0] != 0) { "Splash program: ${GLES30.glGetProgramInfoLog(p)}" }
        return p
    }

    companion object {
        private const val FLOATS = 13
        private const val SAMPLES = 1800
        private const val WAKE_SAMPLES = 900
        private const val WAKE_WIDTH = 16.0
        private val ATTRIBUTES = listOf(Triple(0, 3, 0), Triple(1, 3, 3), Triple(2, 3, 6), Triple(3, 2, 9), Triple(4, 1, 11), Triple(5, 1, 12))

        private val mainWidths = widths(SAMPLES)
        private val wakeWidths = widths(WAKE_SAMPLES)

        private fun widths(samples: Int): DoubleArray {
            val scratch = GuideSample()
            return DoubleArray(samples) { RelayR.widthAt(it.toDouble() / (samples - 1), scratch) }
        }

        /**
         * A camera [PullSplash.CAMERA_DISTANCE] away looking at the R, its lens shifted and its
         * angle chosen so the R lands on the system splash's icon at the still's scale.
         */
        internal fun viewProjection(w: Int, h: Int, icon: IconSpot): FloatArray {
            val d = PullSplash.CAMERA_DISTANCE
            val unit = icon.size * PullSplash.UNIT_PX / PullSplash.ICON_PX
            val fy = 2 * d * unit / h
            val fx = 2 * d * unit / w
            val shiftX = (icon.centerX - w / 2.0) / (w / 2.0)
            val shiftY = (h / 2.0 - icon.centerY) / (h / 2.0)
            val near = 0.01
            val far = 500.0
            val a = (far + near) / (near - far)
            val b = 2 * far * near / (near - far)
            // Projection × a view that only moves the world d away; column-major.
            return floatArrayOf(
                fx.toFloat(), 0f, 0f, 0f,
                0f, fy.toFloat(), 0f, 0f,
                (-shiftX).toFloat(), (-shiftY).toFloat(), a.toFloat(), -1f,
                (shiftX * d).toFloat(), (shiftY * d).toFloat(), (a * -d + b).toFloat(), d.toFloat(),
            )
        }
    }
}
