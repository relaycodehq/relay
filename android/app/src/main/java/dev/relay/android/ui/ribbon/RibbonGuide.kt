package dev.relay.android.ui.ribbon

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * One point the ribbon passes through. [w] is the ribbon's width there in world units (only the
 * R's knots set it: the ribbon carries the R's widths wherever it goes), [twist] its roll around
 * the path in radians, [boost] a widening for flights, which look thin at the R's own width.
 */
internal class Knot(val x: Double, val y: Double, val z: Double, val w: Double, val twist: Double, val boost: Double = 1.0)

/** A sample of a [Guide]: position, tangent, the width direction before twist, twist, width, boost. */
internal class GuideSample {
    val p = DoubleArray(3)
    val t = DoubleArray(3)
    val b = DoubleArray(3)
    var twist = 0.0
    var width = 0.0
    var boost = 1.0
}

/**
 * A path the ribbon slides along: a centripetal Catmull-Rom through the knots, resampled by arc
 * length, with a rotation-minimising frame so the ribbon never flips on its own; twist goes on
 * top. A port of android/tools/splash-icon/ribbon.mjs, which renders the splash's still: the two
 * must agree to the last digit, or the handoff from the system splash jumps.
 */
internal class Guide(knots: List<Knot>, alignKnot: Int) {
    private val pos: DoubleArray
    private val tan: DoubleArray
    private val bin: DoubleArray
    private val twist: DoubleArray
    private val width: DoubleArray
    private val boost: DoubleArray
    private val arc: DoubleArray
    val knotArc: DoubleArray
    val length: Double
    private val count: Int

    init {
        val n = knots.size
        fun coord(i: Int, k: Int): Double = when {
            i < 0 -> 2 * knots[0].c(k) - knots[1].c(k)
            i >= n -> 2 * knots[n - 1].c(k) - knots[n - 2].c(k)
            else -> knots[i].c(k)
        }
        fun scalar(i: Int, f: (Knot) -> Double): Double = when {
            i < 0 -> 2 * f(knots[0]) - f(knots[1])
            i >= n -> 2 * f(knots[n - 1]) - f(knots[n - 2])
            else -> f(knots[i])
        }
        val total = (n - 1) * PER_SEGMENT + 1
        pos = DoubleArray(total * 3)
        twist = DoubleArray(total)
        width = DoubleArray(total)
        boost = DoubleArray(total)
        val knotSample = IntArray(n)
        var m = 0
        val p0 = DoubleArray(3); val p1 = DoubleArray(3); val p2 = DoubleArray(3); val p3 = DoubleArray(3)
        for (i in 0 until n - 1) {
            for (k in 0..2) { p0[k] = coord(i - 1, k); p1[k] = coord(i, k); p2[k] = coord(i + 1, k); p3[k] = coord(i + 2, k) }
            val t0 = 0.0
            val t1 = t0 + max(sqrt(dist(p0, p1)), 1e-4)
            val t2 = t1 + max(sqrt(dist(p1, p2)), 1e-4)
            val t3 = t2 + max(sqrt(dist(p2, p3)), 1e-4)
            knotSample[i] = m
            val last = if (i == n - 2) PER_SEGMENT else PER_SEGMENT - 1
            for (j in 0..last) {
                val x = j.toDouble() / PER_SEGMENT
                val t = t1 + (t2 - t1) * x
                for (k in 0..2) {
                    val a1 = p0[k] * ((t1 - t) / (t1 - t0)) + p1[k] * ((t - t0) / (t1 - t0))
                    val a2 = p1[k] * ((t2 - t) / (t2 - t1)) + p2[k] * ((t - t1) / (t2 - t1))
                    val a3 = p2[k] * ((t3 - t) / (t3 - t2)) + p3[k] * ((t - t2) / (t3 - t2))
                    val b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
                    val b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
                    pos[m * 3 + k] = b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1))
                }
                width[m] = catmull(scalar(i - 1) { it.w }, knots[i].w, knots[i + 1].w, scalar(i + 2) { it.w }, x)
                twist[m] = catmull(scalar(i - 1) { it.twist }, knots[i].twist, knots[i + 1].twist, scalar(i + 2) { it.twist }, x)
                boost[m] = catmull(scalar(i - 1) { it.boost }, knots[i].boost, knots[i + 1].boost, scalar(i + 2) { it.boost }, x)
                m++
            }
        }
        knotSample[n - 1] = m - 1
        count = m

        arc = DoubleArray(m)
        tan = DoubleArray(m * 3)
        var acc = 0.0
        for (i in 0 until m) {
            if (i > 0) acc += distAt(pos, i, i - 1)
            arc[i] = acc
            val a = max(0, i - 1)
            val b = minOf(m - 1, i + 1)
            val dx = pos[b * 3] - pos[a * 3]; val dy = pos[b * 3 + 1] - pos[a * 3 + 1]; val dz = pos[b * 3 + 2] - pos[a * 3 + 2]
            val l = sqrt(dx * dx + dy * dy + dz * dz).takeIf { it > 0 } ?: 1.0
            tan[i * 3] = dx / l; tan[i * 3 + 1] = dy / l; tan[i * 3 + 2] = dz / l
        }
        length = acc
        knotArc = DoubleArray(n) { arc[knotSample[it]] }

        // Double-reflection rotation-minimising frame (Wang et al. 2008).
        bin = DoubleArray(m * 3)
        val seed = if (abs(tan[2]) < 0.9) doubleArrayOf(0.0, 0.0, 1.0) else doubleArrayOf(1.0, 0.0, 0.0)
        val first = normalize(cross(seed, doubleArrayOf(tan[0], tan[1], tan[2])))
        first.copyInto(bin, 0)
        for (i in 0 until m - 1) {
            val v1 = DoubleArray(3) { pos[(i + 1) * 3 + it] - pos[i * 3 + it] }
            val c1 = dot(v1, v1)
            val r = DoubleArray(3) { bin[i * 3 + it] }
            if (c1 < 1e-12) { r.copyInto(bin, (i + 1) * 3); continue }
            val ti = DoubleArray(3) { tan[i * 3 + it] }
            val kr = 2 / c1 * dot(v1, r)
            val kt = 2 / c1 * dot(v1, ti)
            val rL = DoubleArray(3) { r[it] - v1[it] * kr }
            val tL = DoubleArray(3) { ti[it] - v1[it] * kt }
            val v2 = DoubleArray(3) { tan[(i + 1) * 3 + it] - tL[it] }
            val c2 = dot(v2, v2)
            val next = if (c2 < 1e-12) rL else { val k2 = 2 / c2 * dot(v2, rL); DoubleArray(3) { rL[it] - v2[it] * k2 } }
            normalize(next).copyInto(bin, (i + 1) * 3)
        }

        // Spin the whole frame so the R (planar, z = 0) lies flat facing the camera.
        val ref = knotSample[alignKnot]
        val tr = DoubleArray(3) { tan[ref * 3 + it] }
        val flat = normalize(cross(doubleArrayOf(0.0, 0.0, 1.0), tr))
        val br = DoubleArray(3) { bin[ref * 3 + it] }
        val phi = atan2(dot(cross(br, flat), tr), dot(br, flat))
        val c = cos(phi); val s = sin(phi)
        for (i in 0 until m) {
            val ti = DoubleArray(3) { tan[i * 3 + it] }
            val bi = DoubleArray(3) { bin[i * 3 + it] }
            val tb = cross(ti, bi)
            normalize(DoubleArray(3) { bi[it] * c + tb[it] * s }).copyInto(bin, i * 3)
        }
    }

    /** Writes the guide at distance [u] into [out]; past either end it carries on straight. */
    fun sample(u: Double, out: GuideSample) {
        val last = count - 1
        when {
            u <= 0 -> at(0, 0.0, u, out)
            u >= length -> at(last, 0.0, u - length, out)
            else -> {
                var lo = 0
                var hi = last
                while (hi - lo > 1) {
                    val mid = (lo + hi) ushr 1
                    if (arc[mid] <= u) lo = mid else hi = mid
                }
                val span = (arc[hi] - arc[lo]).takeIf { it != 0.0 } ?: 1.0
                at(lo, (u - arc[lo]) / span, 0.0, out)
            }
        }
    }

    private fun at(i: Int, f: Double, beyond: Double, out: GuideSample) {
        val j = minOf(i + 1, count - 1)
        for (k in 0..2) out.t[k] = tan[i * 3 + k] + (tan[j * 3 + k] - tan[i * 3 + k]) * f
        normalizeInPlace(out.t)
        for (k in 0..2) out.b[k] = bin[i * 3 + k] + (bin[j * 3 + k] - bin[i * 3 + k]) * f
        val bt = dot(out.b, out.t)
        for (k in 0..2) out.b[k] -= out.t[k] * bt
        normalizeInPlace(out.b)
        for (k in 0..2) out.p[k] = pos[i * 3 + k] + (pos[j * 3 + k] - pos[i * 3 + k]) * f + out.t[k] * beyond
        out.twist = twist[i] + (twist[j] - twist[i]) * f
        out.width = width[i] + (width[j] - width[i]) * f
        out.boost = boost[i] + (boost[j] - boost[i]) * f
    }

    private fun distAt(a: DoubleArray, i: Int, j: Int): Double {
        val dx = a[i * 3] - a[j * 3]; val dy = a[i * 3 + 1] - a[j * 3 + 1]; val dz = a[i * 3 + 2] - a[j * 3 + 2]
        return sqrt(dx * dx + dy * dy + dz * dz)
    }

    private companion object {
        const val PER_SEGMENT = 48
    }
}

private fun Knot.c(k: Int) = when (k) { 0 -> x; 1 -> y; else -> z }

private fun catmull(a0: Double, a1: Double, a2: Double, a3: Double, x: Double) =
    0.5 * (2 * a1 + (-a0 + a2) * x + (2 * a0 - 5 * a1 + 4 * a2 - a3) * x * x + (-a0 + 3 * a1 - 3 * a2 + a3) * x * x * x)

internal fun dot(a: DoubleArray, b: DoubleArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

internal fun cross(a: DoubleArray, b: DoubleArray) = doubleArrayOf(
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
)

private fun dist(a: DoubleArray, b: DoubleArray): Double {
    val dx = a[0] - b[0]; val dy = a[1] - b[1]; val dz = a[2] - b[2]
    return sqrt(dx * dx + dy * dy + dz * dz)
}

private fun normalize(a: DoubleArray): DoubleArray {
    val l = sqrt(dot(a, a)).takeIf { it > 0 } ?: 1.0
    return doubleArrayOf(a[0] / l, a[1] / l, a[2] / l)
}

private fun normalizeInPlace(a: DoubleArray) {
    val l = sqrt(dot(a, a)).takeIf { it > 0 } ?: 1.0
    a[0] /= l; a[1] /= l; a[2] /= l
}

/**
 * The Relay R's centreline, traced off assets/relay-mark.svg (its inner coordinates): x, y, ribbon
 * width, twist in half turns, depth. The two hairpins (the bottom of the loop, the fold under the
 * bowl) roll half a turn, so the ribbon goes edge-on there the way a folded ribbon does; the bowl
 * sits a hair in front of the stem where they cross.
 */
internal object RelayR {
    private val MARK = arrayOf(
        doubleArrayOf(115.0, 64.0, 1.0, 0.0, 0.0),
        doubleArrayOf(160.0, 116.0, 8.0, 0.0, 0.0),
        doubleArrayOf(198.0, 175.0, 13.0, 0.0, 0.0),
        doubleArrayOf(226.0, 239.0, 20.0, 0.0, 0.0),
        doubleArrayOf(245.0, 305.0, 26.0, 0.0, 0.0),
        doubleArrayOf(254.0, 375.0, 29.0, 0.0, 0.0),
        doubleArrayOf(246.0, 410.0, 26.0, 0.25, 0.0),
        doubleArrayOf(229.0, 431.0, 22.0, 0.5, 0.0),
        doubleArrayOf(210.0, 414.0, 26.0, 0.75, 0.0),
        doubleArrayOf(186.0, 388.0, 30.0, 1.0, 0.0),
        doubleArrayOf(163.0, 355.0, 33.0, 1.0, 0.0),
        doubleArrayOf(145.0, 320.0, 33.0, 1.0, 0.0),
        doubleArrayOf(134.0, 285.0, 31.0, 1.0, 0.0),
        doubleArrayOf(132.0, 256.0, 29.0, 1.0, 0.0),
        doubleArrayOf(143.0, 234.0, 29.0, 1.0, 2.0),
        doubleArrayOf(165.0, 224.0, 29.0, 1.0, 4.0),
        doubleArrayOf(205.0, 224.0, 31.0, 1.0, 4.0),
        doubleArrayOf(245.0, 229.0, 31.0, 1.0, 4.0),
        doubleArrayOf(285.0, 240.0, 30.0, 1.0, 2.0),
        doubleArrayOf(322.0, 251.0, 30.0, 1.0, 0.0),
        doubleArrayOf(360.0, 265.0, 29.0, 1.0, 0.0),
        doubleArrayOf(390.0, 279.0, 27.0, 1.2, 0.0),
        doubleArrayOf(405.0, 291.0, 24.0, 1.5, 0.0),
        doubleArrayOf(388.0, 302.0, 24.0, 1.8, 0.0),
        doubleArrayOf(352.0, 296.0, 25.0, 2.0, 0.0),
        doubleArrayOf(322.0, 298.0, 28.0, 2.0, 0.0),
        doubleArrayOf(300.0, 314.0, 30.0, 2.0, 0.0),
        doubleArrayOf(316.0, 336.0, 27.0, 2.0, 0.0),
        doubleArrayOf(340.0, 355.0, 26.0, 2.0, 0.0),
        doubleArrayOf(386.0, 387.0, 25.0, 2.0, 0.0),
        doubleArrayOf(430.0, 416.0, 23.0, 2.0, 0.0),
        doubleArrayOf(460.0, 437.0, 20.0, 2.0, 0.0),
        doubleArrayOf(480.0, 456.0, 17.0, 2.0, 0.0),
        doubleArrayOf(493.0, 476.0, 12.0, 2.0, 0.0),
        doubleArrayOf(497.0, 494.0, 3.0, 2.0, 0.0),
    )
    private const val UNIT = 100.0

    val knots: List<Knot> = MARK.map { (x, y, w, tw, z) ->
        Knot((x - 310) / UNIT, -(y - 285) / UNIT, z / UNIT, w * 1.12 / UNIT, tw * PI)
    }

    /** The knot the frame is aligned on: the middle of the stem. */
    const val ALIGN = 4

    /** The R on its own, which sets the ribbon's widths along its length. */
    val guide = Guide(knots, ALIGN)

    /** Width at [s], 0 at the R's top tip to 1 at the end of its leg. */
    fun widthAt(s: Double, scratch: GuideSample): Double {
        guide.sample(s * guide.length, scratch)
        return scratch.width
    }
}
