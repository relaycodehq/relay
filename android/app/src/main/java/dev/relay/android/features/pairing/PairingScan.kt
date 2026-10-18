package dev.relay.android.features.pairing

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/** A code the camera read: its text, and its modules row by row from the top left, 1 where dark. */
class SeenCode(val text: String, val size: Int, val modules: ByteArray)

/** Where the scan has got to in one frame. All zero, with `burst` below 0, is the plain field. */
class ScanScene(
    /** The viewfinder's centre and half size, NDC. */
    val window: FloatArray,
) {
    var gather = 0f
    var clear = 0f
    var rest = 0f
    var lock = 0f
    var charge = 0f
    /** Seconds since the code burst into the field; below 0 when it hasn't. */
    var burst = -1f
    var flash = 0f
    var beacon = 1f
    /** The code's square (0..1, top left first) to the screen, NDC. */
    var code = Mat3.identity
    var camera = false
    var cameraAlpha = 1f
    var entering = false
    var front = Halftone.FROM
    var entrance = 0f
    var develop = 0f
    var covers = 0f
    var shade = 0f
    var lifted = false
}

/**
 * Seconds and points of the way in. The field's near dots fold up into the viewfinder's grid, the
 * grid's dots take the camera's light from its middle out, then a front runs out of the viewfinder:
 * ahead of it the field, on it new dots, behind it the dots swell shut into the picture.
 */
object Halftone {
    const val LAND = 0.6f
    const val DEVELOP_AT = 0.55f
    const val DEVELOP_FOR = 0.4f
    const val FRONT_AT = 0.85f
    const val FRONT_FOR = 1.15f
    const val FROM = -125f
    const val DURATION = FRONT_AT + FRONT_FOR

    fun front(seconds: Float, to: Float): Float {
        val u = clamp((seconds - FRONT_AT) / FRONT_FOR)
        return FROM + (to - FROM) * (u * (1.4f - 0.4f * u))
    }

    fun developed(seconds: Float) = clamp((seconds - DEVELOP_AT) / DEVELOP_FOR)

    /** Points from the viewfinder's edge, negative inside; as the shader's frontDistance. */
    fun distance(p: Vec2): Float {
        val qx = kotlin.math.abs(p.x) - 45
        val qy = kotlin.math.abs(p.y) - 45
        return kotlin.math.hypot(max(qx, 0f), max(qy, 0f)) + min(max(qx, qy), 0f) - 80
    }
}

/**
 * The pairing screen's scan, as the iPhone has it: the field's near dots land in the viewfinder
 * and take the camera's light, and the picture develops out across the screen from there; once a
 * code's read its dots lock on, the code bursts back into the field, and the computer's ring goes
 * out across it when the pairing goes through.
 *
 * Advanced on the field's GL thread, told what happened on the main one; [onRead] runs under its
 * lock, so it mustn't call back in.
 */
class PairingScan {
    enum class Phase { Idle, Opening, Looking, Locking, Bursting, Waiting, Answering, Paired, Closing }
    /** What the words and buttons show. */
    enum class Face { Idle, Scan, Pairing, Paired }

    private val faceState = MutableStateFlow(Face.Idle)
    val face: StateFlow<Face> = faceState.asStateFlow()
    private val coversState = MutableStateFlow(false)
    /** The camera covers the screen: the chrome turns white over it. */
    val cameraCovers: StateFlow<Boolean> = coversState.asStateFlow()

    var phase = Phase.Idle
        private set
    /** Called with a code's text once one's read; says whether it's a Relay pairing code. */
    var onRead: (String) -> Boolean = { false }
    var reduceMotion = false
    /** The camera has given a picture: the landed dots wait for it before they take its light. */
    var cameraLive = false
    var code: SeenCode? = null
        private set
    private var target: List<Vec2> = emptyList()
    private var corners: MutableList<Vec2> = mutableListOf()
    private var t = 0.0
    private var time = 0.0
    private var open = 0.0
    private var burstAt = -1.0
    private var held = 0f
    private var outcome: Boolean? = null
    private var answerDue = false

    val wantsCamera: Boolean
        @Synchronized get() = when (phase) {
            Phase.Opening, Phase.Looking, Phase.Locking, Phase.Closing -> true
            Phase.Bursting -> t < 0.45
            else -> false
        }

    @Synchronized
    fun start() {
        if (phase != Phase.Idle && phase != Phase.Paired && phase != Phase.Closing) return
        code = null
        outcome = null
        burstAt = -1.0
        go(Phase.Opening)
    }

    @Synchronized
    fun close() {
        if (phase == Phase.Opening || phase == Phase.Looking) go(Phase.Closing)
    }

    /** A pairing started without the camera, from a pasted or opened link. */
    @Synchronized
    fun pairingWithoutScan() {
        if (phase != Phase.Idle && phase != Phase.Paired) return
        outcome = null
        go(Phase.Waiting)
    }

    @Synchronized
    fun paired() {
        outcome = true
        if (phase == Phase.Waiting) answer()
    }

    /** A refusal before the burst folds the scan away; after it, the burst plays out first. */
    @Synchronized
    fun failed() {
        outcome = false
        if (phase == Phase.Waiting) go(Phase.Idle)
        if (phase == Phase.Locking) go(Phase.Closing)
    }

    /** The camera read a code. False when it isn't one to pair with, so the camera keeps looking. */
    @Synchronized
    fun seen(seen: SeenCode, at: List<Vec2>): Boolean {
        if ((phase != Phase.Opening && phase != Phase.Looking) || code != null || !onRead(seen.text)) return false
        code = seen
        target = at
        corners = at.toMutableList()
        return true
    }

    @Synchronized
    fun moved(to: List<Vec2>) {
        if (code != null && to.size == 4) target = to
    }

    /** True once, the frame the computer's answer should go out. */
    @Synchronized
    fun takeAnswer(): Boolean = answerDue.also { answerDue = false }

    private fun answer() {
        open = 0.0
        answerDue = true
        go(Phase.Answering)
    }

    private fun go(next: Phase) {
        phase = next
        t = 0.0
        if (next == Phase.Bursting) burstAt = time
        faceState.value = when (next) {
            Phase.Idle, Phase.Closing -> Face.Idle
            Phase.Opening, Phase.Looking -> Face.Scan
            Phase.Locking, Phase.Bursting, Phase.Waiting, Phase.Answering -> Face.Pairing
            Phase.Paired -> Face.Paired
        }
    }

    @Synchronized
    fun advance(seconds: Double) {
        // Reduced motion cuts through the moves rather than playing them.
        val dt = seconds * if (reduceMotion) 8 else 1
        t += dt
        time += dt
        // The corners come a few times a second; ease toward the latest so the dots glide.
        val k = (1 - exp(-seconds * 18)).toFloat()
        for (i in corners.indices) if (i < target.size) corners[i] = corners[i] + (target[i] - corners[i]) * k
        held = when (phase) {
            Phase.Locking -> ease((t / 0.9).toFloat())
            Phase.Bursting -> 1f
            else -> max(0f, held - (dt / 0.4).toFloat())
        }
        when (phase) {
            Phase.Opening -> {
                open = min(1.0, open + dt / OPENING)
                if (!cameraLive) open = min(open, (Halftone.DEVELOP_AT / Halftone.DURATION).toDouble())
                if (open >= 1) go(Phase.Looking)
            }
            Phase.Closing -> {
                open = max(0.0, open - dt / 0.9)
                if (open <= 0) go(Phase.Idle)
            }
            Phase.Looking -> if (code != null) go(Phase.Locking)
            Phase.Locking -> if (t >= 1.25) go(Phase.Bursting)
            Phase.Bursting -> if (t >= 1.5) when (outcome) {
                true -> answer()
                false -> go(Phase.Idle)
                null -> go(Phase.Waiting)
            }
            Phase.Answering -> {
                if (t > 0.9) faceState.value = Face.Paired
                if (t >= 2.6) go(Phase.Paired)
            }
            Phase.Idle, Phase.Waiting, Phase.Paired -> {}
        }
    }

    /** `points`: the screen's size in dp. */
    @Synchronized
    fun scene(points: Vec2): ScanScene {
        val s = ScanScene(floatArrayOf(0f, WINDOW_Y, WINDOW_POINTS / (points.x / 2), WINDOW_POINTS / (points.y / 2)))
        s.lock = held
        s.charge = when (phase) {
            Phase.Locking -> ease(((t - 0.95) / 0.3).toFloat())
            Phase.Bursting -> 1f
            else -> 0f
        }
        s.burst = if (burstAt >= 0) (time - burstAt).toFloat() else -1f
        s.flash = if (phase == Phase.Bursting) exp(-t * 4).toFloat() else 0f
        var covers = 0f
        when (phase) {
            Phase.Opening, Phase.Looking, Phase.Locking, Phase.Bursting, Phase.Closing -> {
                val seconds = open.toFloat() * Halftone.DURATION
                // Far enough that the screen's farthest corner closes up too.
                val middle = Vec2(0f, WINDOW_Y * points.y / 2)
                val far = listOf(Vec2(-1f, 1f), Vec2(1f, 1f), Vec2(-1f, -1f), Vec2(1f, -1f))
                    .maxOf { Halftone.distance(Vec2(it.x * points.x / 2, it.y * points.y / 2) - middle) }
                s.camera = true
                s.gather = clamp(seconds / Halftone.LAND)
                s.develop = Halftone.developed(seconds)
                s.front = Halftone.front(seconds, max(640f, far + 280))
                s.entering = phase == Phase.Opening || phase == Phase.Closing
                s.entrance = clamp((open.toFloat() - 0.38f) / 0.62f)
                s.rest = if (s.entering) 0f else 1f
                s.clear = if (s.entering) 0f else 1f
                // The computer goes with the field folding into the viewfinder.
                s.beacon = min(1 - ease((s.front + 10) / 60), 1 - ease(seconds / 0.3f))
                covers = ease((s.front - 110) / 160)
            }
            else -> {}
        }
        if (phase == Phase.Bursting) {
            s.beacon = ease((t.toFloat() - 0.7f) / 0.6f)
            s.cameraAlpha = 1 - ease((t.toFloat() - 0.04f) / 0.34f)
            s.lifted = true
        }
        // The camera falls back into the dark as the dots fly onto the code, so the code they draw
        // isn't lost in the screen it was read off.
        s.shade = 0.85f * s.lock
        if (corners.size == 4) s.code = Mat3.homography(corners)
        s.covers = covers * s.cameraAlpha
        coversState.value = s.covers > 0.5f
        return s
    }

    companion object {
        val OPENING = Halftone.DURATION.toDouble()
        /** The viewfinder: 250dp square, its middle 44% of the way down the screen. */
        const val WINDOW_POINTS = 125f
        const val WINDOW_Y = 0.12f
    }
}

private fun clamp(x: Float) = min(1f, max(0f, x))
private fun ease(x: Float): Float {
    val c = clamp(x)
    return c * c * (3 - 2 * c)
}
