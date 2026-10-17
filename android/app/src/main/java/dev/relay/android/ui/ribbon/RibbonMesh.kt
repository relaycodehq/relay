package dev.relay.android.ui.ribbon

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The R as a small satin ribbon, drawn without GL: a triangle strip along [RelayR.guide], lit per
 * vertex with the splash shader's light (splash_ribbon_fs.glsl, minus the thread detail, which a
 * ribbon this small never shows). At this size a vertex every pixel or so along the ribbon is as
 * good as lighting every pixel. Drawn at twice the size into a bitmap and scaled down, since
 * drawVertices doesn't antialias.
 */
internal class RibbonMesh {
    private var bitmap: Bitmap? = null
    private var canvas: Canvas? = null
    private var verts = FloatArray(0)
    private var colors = IntArray(0)
    private val sample = GuideSample()
    private val col = DoubleArray(3)
    private val meshPaint = Paint()
    private val blitPaint = Paint(Paint.FILTER_BITMAP_FLAG)

    /**
     * Draws the stretch of the R from its top tip to [written] (0..1 of its length) on [target],
     * [height] px tall and centred on ([cx], [cy]). A glint of [glint] strength sits at
     * [glintAt] along the R.
     */
    fun draw(target: Canvas, cx: Float, cy: Float, height: Float, written: Float, glintAt: Float, glint: Float, onWhite: Boolean) {
        if (written <= 0f || height < 2f) return
        val k = SUPERSAMPLE * height / HEIGHT
        val w = (WIDTH * k).roundToInt() + 2 * PAD
        val h = (HEIGHT * k).roundToInt() + 2 * PAD
        val bmp = bitmap?.takeIf { it.width == w && it.height == h }
            ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { bitmap = it; canvas = Canvas(it) }
        bmp.eraseColor(0)
        val guide = RelayR.guide
        val span = guide.length * written.coerceAtMost(1f)
        val samples = max(16, (span * k * 0.5).roundToInt())
        if (verts.size < samples * 4) {
            verts = FloatArray(samples * 4)
            colors = IntArray(samples * 2)
        }
        val ox = w / 2.0 - CENTER_X * k
        val oy = h / 2.0 + CENTER_Y * k
        val g = sample
        for (i in 0 until samples) {
            val u = span * i / (samples - 1)
            guide.sample(u, g)
            val t = g.t
            val b = g.b
            val n0 = cross(t, b)
            val c = cos(g.twist)
            val s = sin(g.twist)
            val wx = b[0] * c + n0[0] * s
            val wy = b[1] * c + n0[1] * s
            val wz = b[2] * c + n0[2] * s
            val half = g.width * k / 2
            val px = ox + g.p[0] * k
            val py = oy - g.p[1] * k
            verts[i * 4] = (px - wx * half).toFloat()
            verts[i * 4 + 1] = (py + wy * half).toFloat()
            verts[i * 4 + 2] = (px + wx * half).toFloat()
            verts[i * 4 + 3] = (py - wy * half).toFloat()
            val color = shade(t, t[1] * wz - t[2] * wy, t[2] * wx - t[0] * wz, t[0] * wy - t[1] * wx, u / guide.length, glintAt, glint, onWhite)
            colors[i * 2] = color
            colors[i * 2 + 1] = color
        }
        canvas!!.drawVertices(Canvas.VertexMode.TRIANGLE_STRIP, samples * 4, verts, 0, null, 0, colors, 0, null, 0, 0, meshPaint)
        target.save()
        target.translate(cx, cy)
        target.scale(1f / SUPERSAMPLE, 1f / SUPERSAMPLE)
        target.drawBitmap(bmp, -w / 2f, -h / 2f, blitPaint)
        target.restore()
    }

    /** The splash shader's satin for a camera straight ahead, as an ARGB colour. */
    private fun shade(t: DoubleArray, nx0: Double, ny0: Double, nz0: Double, along: Double, glintAt: Float, glint: Float, onWhite: Boolean): Int {
        val l = sqrt(nx0 * nx0 + ny0 * ny0 + nz0 * nz0).takeIf { it > 0 } ?: 1.0
        val front = nz0 >= 0
        val f = if (front) 1 / l else -1 / l
        val nx = nx0 * f
        val ny = ny0 * f
        val nz = nz0 * f
        val ndl = max(nx * L1[0] + ny * L1[1] + nz * L1[2], 0.0)
        val wrap = ndl * 0.75 + 0.25
        for (i in 0..2) {
            col[i] = if (front) {
                mix(mix(DEEP[i], LILAC[i], smooth(0.0, 0.72, wrap)), PALE[i], smooth(0.7, 1.0, wrap))
            } else {
                mix(DEEP[i] * 0.6, LILAC[i] * 0.66, smooth(0.1, 1.0, wrap))
            }
            // The shader darkens the edges; across a strip two vertices wide that averages out to this.
            col[i] *= (if (onWhite) 0.8 else 1.0) * 0.98
        }
        val s1 = sheen(t, H1, if (front) 70.0 else 10.0) * (if (front) 0.95 else 0.1) * smooth(0.0, 0.25, ndl)
        val s2 = sheen(t, H2, 48.0) * (if (front) 0.26 else 0.05)
        val shine = if (onWhite) 0.55 else 1.0
        // Reflection of the straight-ahead view about N, against the soft box overhead.
        val rz = 2 * nz
        val env = smooth(0.4, 1.0, (2 * nz * nx) * BOX[0] + (2 * nz * ny) * BOX[1] + (rz * nz - 1) * BOX[2])
        val g = exp(-((along - glintAt) / 0.035).pow(2)) * glint
        for (i in 0..2) {
            col[i] += shine * (s1 * SHEEN1[i] + s2 * SHEEN2[i]) + env * (if (front) 0.18 else 0.04) * ENV[i]
            val over = max(col[i] - 0.86, 0.0)
            col[i] = min(col[i], 0.86) + over / (1 + over * 7)
            col[i] += g * (if (front) GLINT_FRONT[i] else GLINT_BACK[i])
        }
        fun channel(v: Double) = (v.coerceIn(0.0, 1.0) * 255).roundToInt()
        return (0xFF shl 24) or (channel(col[0]) shl 16) or (channel(col[1]) shl 8) or channel(col[2])
    }

    private fun sheen(t: DoubleArray, h: DoubleArray, power: Double): Double {
        val d = t[0] * h[0] + t[1] * h[1] + t[2] * h[2]
        return sqrt(max(0.0, 1 - d * d)).pow(power)
    }

    private companion object {
        const val SUPERSAMPLE = 2
        const val PAD = 4

        /** The R's extent in world units (relay-mark.svg x 115..497, y 64..494) and its middle. */
        const val WIDTH = 3.82
        const val HEIGHT = 4.30
        const val CENTER_X = -0.04
        const val CENTER_Y = 0.06

        val DEEP = doubleArrayOf(0.42, 0.38, 0.6)
        val LILAC = doubleArrayOf(0.79, 0.75, 0.96)
        val PALE = doubleArrayOf(0.96, 0.945, 1.0)
        val SHEEN1 = doubleArrayOf(1.0, 0.985, 1.0)
        val SHEEN2 = doubleArrayOf(0.7, 0.62, 1.0)
        val ENV = doubleArrayOf(0.95, 0.93, 1.0)
        val GLINT_FRONT = doubleArrayOf(0.6, 0.58, 0.66)
        val GLINT_BACK = doubleArrayOf(0.28, 0.26, 0.34)

        private val VIEW = doubleArrayOf(0.0, 0.0, 1.0)
        val L1 = norm(doubleArrayOf(-0.45, 0.7, 0.6))
        val H1 = norm(DoubleArray(3) { L1[it] + VIEW[it] })
        val H2 = norm(DoubleArray(3) { norm(doubleArrayOf(0.75, -0.35, 0.35))[it] + VIEW[it] })
        val BOX = norm(doubleArrayOf(-0.3, 0.85, 0.45))

        fun norm(a: DoubleArray): DoubleArray {
            val l = sqrt(dot(a, a))
            return doubleArrayOf(a[0] / l, a[1] / l, a[2] / l)
        }

        fun mix(a: Double, b: Double, x: Double) = a + (b - a) * x

        fun smooth(a: Double, b: Double, x: Double): Double {
            val t = ((x - a) / (b - a)).coerceIn(0.0, 1.0)
            return t * t * (3 - 2 * t)
        }
    }
}
