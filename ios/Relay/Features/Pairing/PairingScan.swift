import Foundation
import simd

/// A code the camera read: its text, and its modules row by row from the top left, 1 where dark.
struct SeenCode {
    let text: String
    let size: Int
    let modules: [UInt8]
}

/// Where the scan has got to in one frame. All zero, with `burst` below 0, is the plain field.
struct ScanScene {
    /// The viewfinder's centre and half size, NDC.
    var window: SIMD4<Float>
    /// The near dots on their way into the viewfinder.
    var gather: Float = 0
    /// The viewfinder's inside cleared to its corner marks.
    var clear: Float = 0
    /// The rest of the field gone.
    var rest: Float = 0
    /// Dots on the code's dark modules.
    var lock: Float = 0
    /// The locked dots drawing in, white, just before the code bursts.
    var charge: Float = 0
    /// Seconds since the code burst into the field; below 0 when it hasn't.
    var burst: Float = -1
    /// The flash where the code was.
    var flash: Float = 0
    /// The computer's glow in the field.
    var beacon: Float = 1
    /// The code's square (0..1, top left first) to the screen, NDC.
    var code = matrix_identity_float3x3
    /// The camera under the field, how much of it shows, and the shade the lock-on puts over it.
    var camera = false
    var cameraAlpha: Float = 1
    /// The way in or out is playing: the halftone's front, not `rest`, takes the field.
    var entering = false
    /// How far the halftone's front has run from the viewfinder's edge, points; negative inside it.
    var front = Halftone.from
    /// The way in, 0..1: the lens settles over it.
    var entrance: Float = 0
    /// How far the viewfinder's landed dots have taken the camera's light, 0..1.
    var develop: Float = 0
    /// How much of the screen the camera covers: the scanner's dots lighten over it.
    var covers: Float = 0
    var shade: Float = 0
    /// The code gone out of the screen, leaving a dark square where it was.
    var lifted = false
}

/// Seconds and points of the way in. The field's near dots fold up into the viewfinder's grid, the
/// grid's dots take the camera's light from its middle out, then a front runs out of the viewfinder:
/// ahead of it the field, on it new dots, behind it the dots swell shut into the picture.
nonisolated enum Halftone {
    static let land: Float = 0.6
    static let developAt: Float = 0.55
    static let developFor: Float = 0.4
    static let frontAt: Float = 0.85
    static let frontFor: Float = 1.15
    static let from: Float = -125
    static let duration = frontAt + frontFor

    /// Nearly even, easing off at the end only: a wave, not a burst. `to` is far enough to close
    /// the screen's farthest corner.
    static func front(_ seconds: Float, to: Float) -> Float {
        let u = min(1, max(0, (seconds - frontAt) / frontFor))
        return from + (to - from) * (u * (1.4 - 0.4 * u))
    }

    /// How far the viewfinder's dots have taken the camera's light, 0..1, as Ripples.metal's develop.
    static func developed(_ seconds: Float) -> Float { min(1, max(0, (seconds - developAt) / developFor)) }

    /// Points from the viewfinder's edge, negative inside, `p` from its middle; rounder at the
    /// corners than the viewfinder, as Ripples.metal's frontDistance.
    static func distance(_ p: SIMD2<Float>) -> Float {
        let q = abs(p) - SIMD2(repeating: 45)
        return simd_length(simd_max(q, .zero)) + min(max(q.x, q.y), 0) - 80
    }
}

/// The pairing screen's scan, as the preview has it: the field's near dots land in the viewfinder
/// and take the camera's light, and the picture develops out across the screen from there; once a
/// code's read its dots lock on, the code bursts back into the field,
/// and the computer's ring goes out across it when the pairing goes through.
@Observable final class PairingScan {
    enum Phase { case idle, opening, looking, locking, bursting, waiting, answering, paired, closing }
    /// What the words and buttons show.
    enum Face { case idle, scan, pairing, paired }

    private(set) var face = Face.idle
    /// The camera covers the screen: the chrome turns white over it.
    private(set) var cameraCovers = false

    @ObservationIgnored private(set) var phase = Phase.idle
    /// Called with a code's text once one's read; says whether it's a Relay pairing code.
    @ObservationIgnored var onRead: (String) -> Bool = { _ in false }
    @ObservationIgnored var reduceMotion = false
    /// The camera has given a picture: the landed dots wait for it before they take its light.
    @ObservationIgnored var cameraLive = false
    /// The code being paired with, and its corners on the screen (NDC: top left, top right, bottom right, bottom left).
    @ObservationIgnored private(set) var code: SeenCode?
    @ObservationIgnored private var target: [SIMD2<Float>] = []
    @ObservationIgnored private var corners: [SIMD2<Float>] = []
    /// Seconds in the current phase.
    @ObservationIgnored private var t = 0.0
    @ObservationIgnored private var time = 0.0
    /// How far the way in has got, 0..1; closing runs it backwards.
    @ObservationIgnored private var open = 0.0
    @ObservationIgnored private var burstAt = -1.0
    /// The dots' hold on the code: let go of over a moment when a refusal ends the scan early.
    @ObservationIgnored private var held: Float = 0
    /// How the pairing went, once it has: the ending waits on it.
    @ObservationIgnored private var outcome: Bool?
    @ObservationIgnored private var answerDue = false

    static let opening = Double(Halftone.duration)
    /// The viewfinder: 250 points square, its middle 44% of the way down the screen.
    static let windowPoints = 125.0
    static let windowY: Float = 0.12

    /// The camera's wanted from the tap until it has faded out behind the burst.
    var wantsCamera: Bool {
        switch phase {
        case .opening, .looking, .locking, .closing: true
        case .bursting: t < 0.45
        default: false
        }
    }

    func start() {
        guard phase == .idle || phase == .paired || phase == .closing else { return }
        code = nil
        outcome = nil
        burstAt = -1
        go(.opening)
    }

    func close() {
        guard phase == .opening || phase == .looking else { return }
        go(.closing)
    }

    /// A pairing started without the camera, from a pasted or opened link.
    func pairingWithoutScan() {
        guard phase == .idle || phase == .paired else { return }
        outcome = nil
        go(.waiting)
    }

    func paired() {
        outcome = true
        if phase == .waiting { answer() }
    }

    /// A refusal before the burst folds the scan away rather than celebrating; after it, the
    /// burst plays out first.
    func failed() {
        outcome = false
        if phase == .waiting { go(.idle) }
        if phase == .locking { go(.closing) }
    }

    /// The camera read a code. False when it isn't one to pair with, so the camera keeps looking.
    func seen(_ seen: SeenCode, at points: [SIMD2<Float>]) -> Bool {
        guard phase == .opening || phase == .looking, code == nil, onRead(seen.text) else { return false }
        code = seen
        target = points
        corners = points
        return true
    }

    func moved(to points: [SIMD2<Float>]) {
        guard code != nil, points.count == 4 else { return }
        target = points
    }

    /// True once, the frame the computer's answer should go out.
    func takeAnswer() -> Bool {
        defer { answerDue = false }
        return answerDue
    }

    private func answer() {
        open = 0
        answerDue = true
        go(.answering)
    }

    private func go(_ next: Phase) {
        phase = next
        t = 0
        if next == .bursting { burstAt = time }
        let nextFace: Face =
            switch next {
            case .idle, .closing: .idle
            case .opening, .looking: .scan
            case .locking, .bursting, .waiting, .answering: .pairing
            case .paired: .paired
            }
        if face != nextFace { face = nextFace }
    }

    func advance(_ seconds: Double) {
        // Reduced motion cuts through the moves rather than playing them.
        let dt = seconds * (reduceMotion ? 8 : 1)
        t += dt
        time += dt
        // The corners come a few times a second; ease toward the latest so the dots glide.
        let k = Float(1 - exp(-seconds * 18))
        for i in corners.indices where i < target.count { corners[i] += (target[i] - corners[i]) * k }
        switch phase {
        case .locking: held = ease(t / 0.9)
        case .bursting: held = 1
        default: held = max(0, held - Float(dt / 0.4))
        }
        switch phase {
        case .opening:
            open = min(1, open + dt / Self.opening)
            if !cameraLive { open = min(open, Double(Halftone.developAt / Halftone.duration)) }
            if open >= 1 { go(.looking) }
        case .closing:
            open = max(0, open - dt / 0.9)
            if open <= 0 { go(.idle) }
        case .looking:
            if code != nil { go(.locking) }
        case .locking:
            if t >= 1.25 { go(.bursting) }
        case .bursting:
            if t >= 1.5 {
                switch outcome {
                case true?: answer()
                case false?: go(.idle)
                case nil: go(.waiting)
                }
            }
        case .answering:
            if t > 0.9, face != .paired { face = .paired }
            if t >= 2.6 { go(.paired) }
        case .idle, .waiting, .paired: break
        }
    }

    /// `points`: the screen's size in points.
    func scene(points: SIMD2<Float>) -> ScanScene {
        let half = SIMD2(repeating: Float(Self.windowPoints)) / (points / 2)
        var s = ScanScene(window: SIMD4(0, Self.windowY, half.x, half.y))
        s.lock = held
        s.charge = phase == .locking ? ease((t - 0.95) / 0.3) : phase == .bursting ? 1 : 0
        s.burst = burstAt >= 0 ? Float(time - burstAt) : -1
        s.flash = phase == .bursting ? Float(exp(-t * 4)) : 0
        var covers: Float = 0
        switch phase {
        case .opening, .looking, .locking, .bursting, .closing:
            let seconds = Float(open) * Halftone.duration
            // Far enough that the screen's farthest corner closes up too.
            let middle = SIMD2<Float>(0, Self.windowY * points.y / 2)
            let far = [SIMD2<Float>(-1, 1), [1, 1], [-1, -1], [1, -1]].map { Halftone.distance($0 * points / 2 - middle) }.max() ?? 0
            s.camera = true
            s.gather = clamp(seconds / Halftone.land)
            s.develop = Halftone.developed(seconds)
            s.front = Halftone.front(seconds, to: max(640, far + 280))
            s.entering = phase == .opening || phase == .closing
            s.entrance = clamp((Float(open) - 0.38) / 0.62)
            // The front takes the field dot by dot; once it has run, none is left.
            s.rest = s.entering ? 0 : 1
            s.clear = s.entering ? 0 : 1
            // The computer's glow sits just above the viewfinder: the front reaches it first.
            s.beacon = 1 - ease((s.front + 10) / 60)
            covers = ease((s.front - 110) / 160)
        default: break
        }
        if phase == .bursting {
            s.beacon = ease((Float(t) - 0.7) / 0.6)
            s.cameraAlpha = 1 - ease((Float(t) - 0.04) / 0.34)
            s.lifted = true
        }
        s.shade = 0.35 * s.lock
        if corners.count == 4 { s.code = Self.homography(corners) }
        s.covers = covers * s.cameraAlpha
        let on = s.covers > 0.5
        if cameraCovers != on { cameraCovers = on }
        return s
    }

    private func clamp(_ x: Float) -> Float { min(1, max(0, x)) }
    private func ease(_ x: Float) -> Float {
        let c = clamp(x)
        return c * c * (3 - 2 * c)
    }
    private func ease(_ x: Double) -> Float { ease(Float(x)) }

    /// The unit square onto the four corners (top left, top right, bottom right, bottom left), so a
    /// module lands where the camera sees it even with the code in perspective.
    static func homography(_ p: [SIMD2<Float>]) -> simd_float3x3 {
        let (x0, y0, x1, y1, x2, y2, x3, y3) = (p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y)
        let dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
        let dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
        let den = dx1 * dy2 - dx2 * dy1
        let g = abs(den) > 1e-9 ? (dx3 * dy2 - dx2 * dy3) / den : 0
        let h = abs(den) > 1e-9 ? (dx1 * dy3 - dx3 * dy1) / den : 0
        let a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0
        let d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0
        return simd_float3x3(columns: (SIMD3(a, d, g), SIMD3(b, e, h), SIMD3(c, f, 1)))
    }
}
