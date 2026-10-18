package dev.relay.android.features.pairing

import kotlin.math.abs
import kotlin.math.tan

data class Vec2(val x: Float, val y: Float) {
    operator fun plus(o: Vec2) = Vec2(x + o.x, y + o.y)
    operator fun minus(o: Vec2) = Vec2(x - o.x, y - o.y)
    operator fun times(k: Float) = Vec2(x * k, y * k)
}

/** 3x3 matrices as GL takes them: column-major FloatArray(9). */
object Mat3 {
    val identity get() = floatArrayOf(1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f)

    /**
     * The unit square onto the four corners (top left, top right, bottom right, bottom left), so a
     * module lands where the camera sees it even with the code in perspective.
     */
    fun homography(p: List<Vec2>): FloatArray {
        val (x0, y0) = p[0]
        val (x1, y1) = p[1]
        val (x2, y2) = p[2]
        val (x3, y3) = p[3]
        val dx1 = x1 - x2; val dx2 = x3 - x2; val dx3 = x0 - x1 + x2 - x3
        val dy1 = y1 - y2; val dy2 = y3 - y2; val dy3 = y0 - y1 + y2 - y3
        val den = dx1 * dy2 - dx2 * dy1
        val g = if (abs(den) > 1e-9f) (dx3 * dy2 - dx2 * dy3) / den else 0f
        val h = if (abs(den) > 1e-9f) (dx1 * dy3 - dx3 * dy1) / den else 0f
        val a = x1 - x0 + g * x1; val b = x3 - x0 + h * x3; val c = x0
        val d = y1 - y0 + g * y1; val e = y3 - y0 + h * y3; val f = y0
        return floatArrayOf(a, d, g, b, e, h, c, f, 1f)
    }

    fun inverse(m: FloatArray): FloatArray {
        val (a, d, g) = Triple(m[0], m[1], m[2])
        val (b, e, h) = Triple(m[3], m[4], m[5])
        val (c, f, i) = Triple(m[6], m[7], m[8])
        val A = e * i - f * h; val B = -(d * i - f * g); val C = d * h - e * g
        val det = a * A + b * B + c * C
        if (abs(det) < 1e-12f) return identity
        val k = 1f / det
        // Rows of the inverse are the cofactors' columns; stored column by column.
        return floatArrayOf(
            A * k, B * k, C * k,
            -(b * i - c * h) * k, (a * i - c * g) * k, -(a * h - b * g) * k,
            (b * f - c * e) * k, -(a * f - c * d) * k, (a * e - b * d) * k,
        )
    }

    fun apply(m: FloatArray, x: Float, y: Float): Vec2 {
        val z = m[2] * x + m[5] * y + m[8]
        return Vec2((m[0] * x + m[3] * y + m[6]) / z, (m[1] * x + m[4] * y + m[7]) / z)
    }
}

/** 4x4 column-major, as android.opengl.Matrix keeps them. */
object Mat4 {
    /**
     * Perspective from `eye` toward `target`, the picture moved up by `shift` without turning the
     * camera; clip depth 0..w as Metal has it, which GL's -w..w takes in too.
     */
    fun camera(eye: FloatArray, target: FloatArray, aspect: Float, fov: Float, shift: Float): FloatArray {
        val f = 1 / tan(fov * Math.PI.toFloat() / 360)
        val near = 0.1f
        val far = 200f
        val projection = floatArrayOf(
            f / aspect, 0f, 0f, 0f,
            0f, f, 0f, 0f,
            0f, 0f, far / (near - far), -1f,
            0f, 0f, far * near / (near - far), 0f,
        )
        val z = normalize(floatArrayOf(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]))
        val x = normalize(cross(floatArrayOf(0f, 1f, 0f), z))
        val y = cross(z, x)
        val view = floatArrayOf(
            x[0], y[0], z[0], 0f,
            x[1], y[1], z[1], 0f,
            x[2], y[2], z[2], 0f,
            -dot(x, eye), -dot(y, eye), -dot(z, eye), 1f,
        )
        val vp = FloatArray(16)
        android.opengl.Matrix.multiplyMM(vp, 0, projection, 0, view, 0)
        for (c in 0 until 4) vp[c * 4 + 1] += shift * vp[c * 4 + 3]
        return vp
    }

    private fun dot(a: FloatArray, b: FloatArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    private fun cross(a: FloatArray, b: FloatArray) =
        floatArrayOf(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    private fun normalize(a: FloatArray): FloatArray {
        val l = kotlin.math.sqrt(dot(a, a))
        return floatArrayOf(a[0] / l, a[1] / l, a[2] / l)
    }
}
