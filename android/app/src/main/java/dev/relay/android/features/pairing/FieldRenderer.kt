package dev.relay.android.features.pairing

import android.graphics.SurfaceTexture
import android.opengl.GLES11Ext
import android.opengl.GLES30.*
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.util.Log
import java.nio.ByteBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.tan

/** The field's colours, sRGB 0..1: the muted and accent, and the accent the scanner's dots take over the camera. */
class RipplePalette(
    val base: FloatArray,
    val hot: FloatArray,
    val overCamera: FloatArray,
    val baseAlpha: Float,
    /** The camera's dots are dark on light, like ink. */
    val light: Boolean,
    val background: FloatArray,
)

/** What one frame draws. */
class RippleFrame(
    /** The field's own clock, which stands still under reduced motion. */
    val time: Double,
    val scene: ScanScene,
    /** Modules a side of the code being scanned; 0 before one's seen. */
    val modules: Int,
    /** The computer's answer goes out this frame. */
    val answer: Boolean,
    /** The camera has given a picture since it started. */
    val picture: Boolean,
)

/** How the camera's picture sits in its texture; set from the main thread as CameraX reports it. */
class PictureLayout(
    /** The picture upright, in pixels. */
    val width: Int,
    val height: Int,
    /** Clockwise degrees from the texture's own (transformed) picture to upright. */
    val rotation: Int,
)

/**
 * Draws the pairing screen's field, as the iPhone's RippleRenderer does: dots on a swelling floor,
 * calls going back and forth between the phone and the computer as rings and packets, and the
 * scan's camera in dots under it, with the lock and burst on top.
 */
class FieldRenderer(@Volatile var palette: RipplePalette) : GLSurfaceView.Renderer {
    /** The frame to draw; null skips one. Called on the GL thread. */
    var frame: () -> RippleFrame? = { null }
    /** The camera's surface texture, made with the GL context; the camera draws into it. */
    @Volatile var cameraTexture: SurfaceTexture? = null
        private set
    var onCameraTexture: (SurfaceTexture) -> Unit = {}
    @Volatile var pictureLayout: PictureLayout? = null
    /** Pictures the camera has delivered since it last started. */
    @Volatile var pictures = 0
    /** The modules of the code being scanned, row by row; set when one's read. */
    @Volatile var modules: ByteArray = ByteArray(0)

    private var dots = 0
    private var beacon = 0
    private var glows = 0
    private var camera = 0
    private val locations = HashMap<Int, HashMap<String, Int>>()
    private var cameraName = 0
    private var moduleTexture = 0
    private var uploaded: ByteArray? = null
    @Volatile private var newPicture = false
    private val st = FloatArray(16)
    private var width = 0
    private var height = 0
    /** Device pixels to a dp. */
    private var unit = 1f

    private val pulses = ArrayList<FloatArray>()
    private var last = -1.0
    private var seed = 7L
    private var cycle0 = 0.0
    private var answeredAt = Double.NEGATIVE_INFINITY
    /** How far the view has turned round the computer, radians. */
    private var yaw = 0f
    /** The turn the field's dots were given their places in the viewfinder at. */
    private var scanYaw = 0f
    private var lastGather = 0f
    private var shownVp: FloatArray? = null
    private var shownEye = FloatArray(3)
    private var shownTime = 0.0

    fun setDensity(density: Float) {
        unit = density
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        locations.clear()
        dots = program(DOT_VERTEX, DOT_FRAGMENT)
        beacon = program(BEACON_VERTEX, DOT_FRAGMENT)
        glows = program(GLOW_VERTEX, GLOW_FRAGMENT)
        camera = program(CAMERA_VERTEX, CAMERA_FRAGMENT)
        // Attributeless draws still want a vertex array bound.
        val vao = IntArray(1)
        glGenVertexArrays(1, vao, 0)
        glBindVertexArray(vao[0])

        val names = IntArray(2)
        glGenTextures(2, names, 0)
        cameraName = names[0]
        moduleTexture = names[1]
        glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraName)
        glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
        glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
        uploaded = null
        uploadModules(byteArrayOf(0), 1)

        cameraTexture?.release()
        val texture = SurfaceTexture(cameraName)
        texture.setOnFrameAvailableListener {
            newPicture = true
            pictures++
        }
        cameraTexture = texture
        onCameraTexture(texture)

        glEnable(GL_BLEND)
        glBlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA)
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w
        height = h
        glViewport(0, 0, w, h)
    }

    fun release() {
        cameraTexture?.release()
        cameraTexture = null
    }

    override fun onDrawFrame(gl: GL10?) {
        val bg = palette.background
        glClearColor(bg[0], bg[1], bg[2], 1f)
        glClear(GL_COLOR_BUFFER_BIT)
        if (width == 0 || height == 0 || dots == 0) return
        val f = frame() ?: return
        val time = f.time
        if (f.answer) answer(time)
        schedule(time)
        if (newPicture) {
            newPicture = false
            runCatching { cameraTexture?.updateTexImage() }.onFailure { Log.w(TAG, "Camera picture lost", it) }
        }
        val mods = modules
        if (f.modules > 0 && mods.size == f.modules * f.modules && mods !== uploaded) uploadModules(mods, f.modules)

        val p = palette
        val screen = floatArrayOf(width.toFloat(), height.toFloat())
        // The view turns slowly round the computer on the field's clock; eye and aim turn together.
        yaw = ((time / TURN_SECONDS) % 1.0 * 2 * PI).toFloat()
        val eye = turn(EYE)
        val vp = Mat4.camera(eye, turn(TARGET), screen[0] / screen[1], FOV, SHIFT)
        shownVp = vp
        shownEye = eye
        shownTime = time
        val px = screen[1] / (2 * tan(FOV * PI.toFloat() / 360))
        val s = f.scene
        if (s.gather > 0 && lastGather == 0f) scanYaw = yaw
        lastGather = s.gather
        val scanHot = mix(p.hot, p.overCamera, s.covers)
        val phase = if (time >= cycle0) (time - cycle0) % CYCLE else -1.0

        // The computer, the other computers, and the calls between the phone and the computer.
        val lit = ArrayList<FloatArray>()
        fun put(clip: FloatArray, size: Float, alpha: Float) {
            if (lit.size >= MAX_GLOWS || alpha <= 0.002f) return
            lit += floatArrayOf(clip[0], clip[1], clip[2], clip[3], size, alpha)
        }
        val clip = FloatArray(4)
        fun world(x: Float, y: Float, z: Float, size: Float, alpha: Float) {
            Matrix.multiplyMV(clip, 0, vp, 0, floatArrayOf(x, y, z, 1f), 0)
            if (clip[3] > 0.1f) put(clip.copyOf(), min(500 * unit, size * px / clip[3]), alpha)
        }
        val field = (1 - s.rest) * s.beacon
        val answerGlow = exp(-(time - answeredAt) * 1.1).toFloat()
        val flash = if (phase >= FLIGHT) exp(-(phase - FLIGHT) * 2.5).toFloat() else 0f
        val bloom = max(flash, answerGlow)
        val beaconY = beaconHeight(time.toFloat())
        for (o in OTHERS) world(o.x, 0.05f, o.y, 0.55f, 0.22f * field)

        val packets = Array(2) { FloatArray(4) }
        fun packet(start: Double, back: Boolean) {
            val t = (phase - start) / FLIGHT
            if (phase < 0 || t <= 0 || t >= 1.12) return
            if (t < 1) {
                val a = arc((t * t * (3 - 2 * t)).toFloat(), back, beaconY)
                packets[if (back) 1 else 0] = floatArrayOf(a[0], a[2], a[1], sin(PI * min(1.0, t * 1.1)).toFloat() * field)
            }
            for (k in 0 until 26) {
                val at = t - k * 0.012
                if (at <= 0 || at >= 1) continue
                val eased = (at * at * (3 - 2 * at)).toFloat()
                val fall = 1 - k / 26f
                val a = arc(eased, back, beaconY)
                world(a[0], a[1], a[2], if (k == 0) 0.5f else 0.2f * fall, (if (k == 0) 1f else 0.55f * fall) * field)
            }
        }
        packet(0.0, back = false)
        packet(FLIGHT + 0.6, back = true)

        if (s.flash > 0) {
            val mid = Mat3.apply(s.code, 0.5f, 0.5f)
            val c = floatArrayOf(mid.x, mid.y, 0f, 1f)
            put(c, (260 + 420 * (1 - s.flash)) * unit, 0.35f * s.flash)
            put(c, 110 * unit, s.flash)
        }

        val waves = FloatArray((SLOTS + 2) * 4)
        pulses.forEachIndexed { i, w -> w.copyInto(waves, i * 4) }
        packets[0].copyInto(waves, SLOTS * 4)
        packets[1].copyInto(waves, (SLOTS + 1) * 4)

        if (s.camera && s.cameraAlpha > 0) drawCamera(s, scanHot, screen, f.picture)

        for (program in intArrayOf(dots, beacon)) {
            if (program == beacon && s.beacon <= 0.002f) continue
            glUseProgram(program)
            glUniformMatrix4fv(loc(program, "viewProjection"), 1, false, vp, 0)
            glUniformMatrix3fv(loc(program, "code"), 1, false, s.code, 0)
            glUniform4fv(loc(program, "window"), 1, s.window, 0)
            glUniform3fv(loc(program, "eye"), 1, eye, 0)
            glUniform3fv(loc(program, "base"), 1, p.base, 0)
            glUniform3fv(loc(program, "hot"), 1, p.hot, 0)
            glUniform3fv(loc(program, "scan"), 1, scanHot, 0)
            glUniform2fv(loc(program, "screen"), 1, screen, 0)
            glUniform1f(loc(program, "time"), time.toFloat())
            glUniform1f(loc(program, "px"), px)
            glUniform1f(loc(program, "unit"), unit)
            glUniform1f(loc(program, "baseAlpha"), p.baseAlpha)
            glUniform1f(loc(program, "gather"), s.gather)
            glUniform1f(loc(program, "clear"), s.clear)
            glUniform1f(loc(program, "lock"), s.lock)
            glUniform1f(loc(program, "charge"), s.charge)
            glUniform1f(loc(program, "burst"), s.burst)
            glUniform1i(loc(program, "modules"), if (uploaded == null || uploaded!!.size <= 1) 0 else f.modules)
            glUniform1f(loc(program, "entering"), if (s.entering) 1f else 0f)
            glUniform1f(loc(program, "develop"), s.develop)
            glUniform1f(loc(program, "turn"), scanYaw)
            glUniform1f(loc(program, "glow"), if (p.light) 0f else 1f)
            glUniform4fv(loc(program, "waves"), SLOTS + 2, waves, 0)
            if (program == dots) {
                glActiveTexture(GL_TEXTURE1)
                glBindTexture(GL_TEXTURE_2D, moduleTexture)
                glUniform1i(loc(program, "moduleMap"), 1)
                glDrawArrays(GL_POINTS, 0, COLS * ROWS * SPECKS)
            } else {
                glUniform1f(loc(program, "beaconAlpha"), s.beacon)
                glUniform1f(loc(program, "bloom"), bloom)
                glUniform1f(loc(program, "beaconY"), beaconY)
                glDrawArrays(GL_POINTS, 0, BEACON_SPECKS)
            }
        }

        if (lit.isNotEmpty()) {
            val tint = if (s.flash > 0) mix(scanHot, floatArrayOf(1f, 1f, 1f), 0.4f) else p.hot
            val clips = FloatArray(lit.size * 4)
            val sizes = FloatArray(lit.size * 2)
            lit.forEachIndexed { i, g ->
                g.copyInto(clips, i * 4, 0, 4)
                g.copyInto(sizes, i * 2, 4, 6)
            }
            glUseProgram(glows)
            glUniform4fv(loc(glows, "glowClip"), lit.size, clips, 0)
            glUniform2fv(loc(glows, "glowSize"), lit.size, sizes, 0)
            glUniform4f(loc(glows, "tint"), tint[0], tint[1], tint[2], 1f)
            glUniform2fv(loc(glows, "screen"), 1, screen, 0)
            glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, lit.size)
        }
    }

    private fun drawCamera(s: ScanScene, accent: FloatArray, screen: FloatArray, picture: Boolean) {
        val layout = pictureLayout
        val live = picture && layout != null && cameraTexture != null
        // Filled as a camera app's preview is: cropped to the screen, never letterboxed.
        val fill = if (layout != null) {
            val iw = layout.width.toFloat()
            val ih = layout.height.toFloat()
            val k = max(screen[0] / iw, screen[1] / ih)
            floatArrayOf(screen[0] / (iw * k), screen[1] / (ih * k))
        } else floatArrayOf(1f, 1f)
        if (live) cameraTexture?.getTransformMatrix(st)
        val c = camera
        glUseProgram(c)
        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraName)
        glUniform1i(loc(c, "camera"), 0)
        glUniformMatrix3fv(loc(c, "picturing"), 1, false, picturing(layout?.rotation ?: 0), 0)
        glUniform1f(loc(c, "hasPicture"), if (live) 1f else 0f)
        glUniformMatrix3fv(loc(c, "uncode"), 1, false, Mat3.inverse(s.code), 0)
        glUniform4fv(loc(c, "window"), 1, s.window, 0)
        glUniform3fv(loc(c, "accent"), 1, accent, 0)
        glUniform2fv(loc(c, "screen"), 1, screen, 0)
        glUniform2fv(loc(c, "fill"), 1, fill, 0)
        glUniform1f(loc(c, "unit"), unit)
        glUniform1f(loc(c, "front"), s.front)
        glUniform1f(loc(c, "entrance"), s.entrance)
        glUniform1f(loc(c, "alpha"), s.cameraAlpha)
        glUniform1f(loc(c, "shade"), s.shade)
        glUniform1f(loc(c, "lifted"), if (s.lifted) 1f else 0f)
        glUniform1f(loc(c, "light"), if (palette.light) 1f else 0f)
        glUniform1f(loc(c, "develop"), s.develop)
        glDrawArrays(GL_TRIANGLES, 0, 3)
    }

    /**
     * The upright picture's square (0..1, top left first) to the camera texture: turned back to the
     * picture the texture's own transform shows, flipped to its bottom-left origin, then through
     * that transform.
     */
    private fun picturing(rotation: Int): FloatArray {
        fun map(ux: Float, uy: Float): Vec2 {
            val (bx, by) = when (rotation) {
                90 -> uy to 1 - ux
                180 -> 1 - ux to 1 - uy
                270 -> 1 - uy to ux
                else -> ux to uy
            }
            val sx = bx
            val sy = 1 - by
            return Vec2(st[0] * sx + st[4] * sy + st[12], st[1] * sx + st[5] * sy + st[13])
        }
        val o = map(0f, 0f)
        val x = map(1f, 0f) - o
        val y = map(0f, 1f) - o
        return floatArrayOf(x.x, x.y, 0f, y.x, y.y, 0f, o.x, o.y, 1f)
    }

    private fun uploadModules(bytes: ByteArray, n: Int) {
        glBindTexture(GL_TEXTURE_2D, moduleTexture)
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST)
        val buffer = ByteBuffer.allocateDirect(bytes.size).put(bytes).apply { position(0) }
        glTexImage2D(GL_TEXTURE_2D, 0, GL_R8UI, n, n, 0, GL_RED_INTEGER, GL_UNSIGNED_BYTE, buffer)
        uploaded = bytes
    }

    /**
     * A ring from where a finger touched the floor, (`x`, `y`) in pixels of the view. False when it
     * touched the sky above the field. Call on the GL thread.
     */
    fun touch(x: Float, y: Float, strength: Float): Boolean {
        val vp = shownVp ?: return false
        if (width == 0 || height == 0) return false
        val nx = x / width * 2 - 1
        val ny = 1 - y / height * 2
        val back = FloatArray(16)
        if (!Matrix.invertM(back, 0, vp, 0)) return false
        val a = FloatArray(4)
        val b = FloatArray(4)
        Matrix.multiplyMV(a, 0, back, 0, floatArrayOf(nx, ny, 0f, 1f), 0)
        Matrix.multiplyMV(b, 0, back, 0, floatArrayOf(nx, ny, 1f, 1f), 0)
        val near = floatArrayOf(a[0] / a[3], a[1] / a[3], a[2] / a[3])
        val far = floatArrayOf(b[0] / b[3], b[1] / b[3], b[2] / b[3])
        val ray = floatArrayOf(far[0] - near[0], far[1] - near[1], far[2] - near[2])
        if (ray[1] >= -1e-4f) return false
        val k = -near[1] / ray[1]
        val hx = near[0] + ray[0] * k
        val hz = near[2] + ray[2] * k
        val e = shownEye
        val dy = 0 - e[1]
        if (kotlin.math.sqrt((hx - e[0]) * (hx - e[0]) + dy * dy + (hz - e[2]) * (hz - e[2])) >= 34) return false
        pulse(hx, hz, shownTime, strength)
        return true
    }

    /** The computer took the code: it flashes and its ring goes out across the field. */
    private fun answer(time: Double) {
        answeredAt = time
        cycle0 = time + 2.4
        pulse(COMPUTER[0], COMPUTER[2], time, 1.4f)
    }

    private fun random(): Double {
        seed = (seed * 16807) % 2_147_483_647
        return seed / 2_147_483_647.0
    }

    private fun pulse(x: Float, z: Float, t0: Double, strength: Float) {
        pulses += floatArrayOf(x, z, t0.toFloat(), strength)
        if (pulses.size > SLOTS) pulses.removeAt(0)
    }

    /** Fires whatever was due between the last frame and this one, at the time it was due. */
    private fun schedule(time: Double) {
        val from = last
        last = time
        fun crossed(at: Double, every: Double): Double? {
            val k = floor((time - at) / every)
            return if (k >= 0 && at + k * every > from) at + k * every else null
        }
        val c = cycle0
        val phone = turn(floatArrayOf(PHONE.x, 0f, PHONE.y))
        crossed(c, CYCLE)?.let { pulse(phone[0], phone[2], it, 0.45f) }
        crossed(c + FLIGHT, CYCLE)?.let { pulse(COMPUTER[0], COMPUTER[2], it, 1.15f) }
        crossed(c + FLIGHT + 0.6, CYCLE)?.let { pulse(COMPUTER[0], COMPUTER[2], it, 0.4f) }
        crossed(c + 2 * FLIGHT + 0.6, CYCLE)?.let { pulse(phone[0], phone[2], it, 1.0f) }
        crossed(1.3, 2.9)?.let {
            val o = OTHERS[min(OTHERS.size - 1, (random() * OTHERS.size).toInt())]
            pulse(o.x, o.y, it, (0.3 + random() * 0.15).toFloat())
        }
    }

    /** Where a packet is `s` of the way along its arc; the two directions bow to opposite sides. */
    private fun arc(s: Float, back: Boolean, to: Float): FloatArray {
        val u = if (back) 1 - s else s
        val side = if (back) -1f else 1f
        val pi = PI.toFloat()
        return turn(
            floatArrayOf(
                PHONE.x + 1.6f * side * (1 - u) + 1.3f * side * sin(pi * u),
                0.1f + 1.7f * sin(pi * u) + (to - 0.1f) * u * u * (3 - 2 * u),
                PHONE.y - 1.5f + (COMPUTER[2] - PHONE.y + 1.5f) * u,
            ),
        )
    }

    /** How high the computer floats: on the swell, lifted by the rings under it, as the shader has the field at its foot. */
    private fun beaconHeight(time: Float): Float {
        val x = COMPUTER[0]
        val z = COMPUTER[2]
        val swell = 0.11f * sin(x * 0.55f + time * 0.6f) * cos(z * 0.42f - time * 0.45f) +
            0.05f * sin(z * 0.9f + x * 0.2f + time * 0.8f)
        var lift = 0f
        var wash = 0f
        for (p in pulses) {
            val age = time - p[2]
            if (age < 0 || p[3] <= 0) continue
            val d = hypot(x - p[0], z - p[1])
            // Its own rings start right under it: it rises softly and floats back down.
            if (d < 0.5f) {
                lift += 0.4f * p[3] * (1 - exp(-age * 4)) * exp(-age * 0.9f)
                continue
            }
            val ring = d - age * 3.4f
            val fade = p[3] * exp(-age * 0.28f)
            lift += fade * exp(-ring * ring / (0.12f + age * 0.06f))
            if (ring <= 0) wash += fade * exp(ring / 1.6f) * exp(-age * 0.9f) * 0.5f
        }
        return 0.32f + swell + 0.5f * lift + 0.08f * wash
    }

    /** A point on your side of the field carried round the computer as far as the view has turned. */
    private fun turn(p: FloatArray): FloatArray {
        val dx = p[0] - COMPUTER[0]
        val dz = p[2] - COMPUTER[2]
        return floatArrayOf(
            COMPUTER[0] + dx * cos(yaw) + dz * sin(yaw),
            p[1],
            COMPUTER[2] - dx * sin(yaw) + dz * cos(yaw),
        )
    }

    private fun loc(program: Int, name: String): Int =
        locations.getOrPut(program) { HashMap() }.getOrPut(name) { glGetUniformLocation(program, name) }

    private fun program(vertex: String, fragment: String): Int {
        fun shader(type: Int, source: String): Int {
            val s = glCreateShader(type)
            glShaderSource(s, source)
            glCompileShader(s)
            val ok = IntArray(1)
            glGetShaderiv(s, GL_COMPILE_STATUS, ok, 0)
            if (ok[0] == 0) error("Field shader didn't compile: ${glGetShaderInfoLog(s)}")
            return s
        }
        val p = glCreateProgram()
        glAttachShader(p, shader(GL_VERTEX_SHADER, vertex))
        glAttachShader(p, shader(GL_FRAGMENT_SHADER, fragment))
        glLinkProgram(p)
        val ok = IntArray(1)
        glGetProgramiv(p, GL_LINK_STATUS, ok, 0)
        if (ok[0] == 0) error("Field program didn't link: ${glGetProgramInfoLog(p)}")
        return p
    }

    private companion object {
        const val TAG = "RelayPair"
        /** As the shader's COLS, ROWS and SPECKS. */
        const val COLS = 118
        const val ROWS = 140
        const val SPECKS = 24
        const val BEACON_SPECKS = 3000
        const val SLOTS = 24
        const val FOV = 50f
        /** The picture moved up the screen, so the field sits above the words. */
        const val SHIFT = 0.34f
        val EYE = floatArrayOf(0f, 2.4f, 7f)
        val TARGET = floatArrayOf(0f, 0f, -8f)
        val PHONE = Vec2(0f, 6.5f)
        /** Seconds for the view to go once round the computer. */
        const val TURN_SECONDS = 90.0
        val COMPUTER = floatArrayOf(0f, 0.05f, -13f)
        val OTHERS = listOf(Vec2(-7f, -11f), Vec2(8f, -17f), Vec2(-3.5f, -21f), Vec2(5.5f, -8f))
        const val FLIGHT = 2.0
        const val CYCLE = 2 * FLIGHT + 1.2
        const val MAX_GLOWS = 72

        fun mix(a: FloatArray, b: FloatArray, t: Float) = FloatArray(3) { a[it] + (b[it] - a[it]) * t }
    }
}
