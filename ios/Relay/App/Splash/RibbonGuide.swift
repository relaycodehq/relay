import Foundation
import simd

/// One point the ribbon passes through. `w` is the ribbon's width there in world units (only the
/// R's knots set it: the ribbon carries the R's widths wherever it goes), `twist` its roll around
/// the path in radians, `boost` a widening for flights, which look thin at the R's own width.
nonisolated struct Knot: Sendable {
    var p: SIMD3<Double>
    var w: Double
    var twist: Double
    var boost = 1.0
}

/// A sample of a `Guide`: position, tangent, the width direction before twist, twist, width, boost.
nonisolated struct GuideSample {
    var p = SIMD3<Double>()
    var t = SIMD3<Double>()
    var b = SIMD3<Double>()
    var twist = 0.0
    var width = 0.0
    var boost = 1.0
}

/// A path the ribbon slides along: a centripetal Catmull-Rom through the knots, resampled by arc
/// length, with a rotation-minimising frame so the ribbon never flips on its own; twist goes on
/// top. A port of Android's RibbonGuide.kt, itself a port of android/tools/splash-icon/ribbon.mjs,
/// which renders the launch still: they must agree, or the handoff from the launch screen jumps.
nonisolated struct Guide: Sendable {
    private let pos: [SIMD3<Double>]
    private let tan: [SIMD3<Double>]
    private let bin: [SIMD3<Double>]
    private let twist: [Double]
    private let width: [Double]
    private let boost: [Double]
    private let arc: [Double]
    let knotArc: [Double]
    let length: Double

    private static let perSegment = 48

    init(_ knots: [Knot], align alignKnot: Int) {
        let n = knots.count
        // Past either end the knots carry on mirrored, so the end segments curve like the rest.
        func point(_ i: Int) -> SIMD3<Double> {
            if i < 0 { return 2 * knots[0].p - knots[1].p }
            if i >= n { return 2 * knots[n - 1].p - knots[n - 2].p }
            return knots[i].p
        }
        func scalar(_ i: Int, _ f: (Knot) -> Double) -> Double {
            if i < 0 { return 2 * f(knots[0]) - f(knots[1]) }
            if i >= n { return 2 * f(knots[n - 1]) - f(knots[n - 2]) }
            return f(knots[i])
        }
        let per = Self.perSegment
        var pos: [SIMD3<Double>] = []
        var twist: [Double] = []
        var width: [Double] = []
        var boost: [Double] = []
        var knotSample = [Int](repeating: 0, count: n)
        for i in 0..<(n - 1) {
            let p0 = point(i - 1), p1 = point(i), p2 = point(i + 1), p3 = point(i + 2)
            let t0 = 0.0
            let t1 = t0 + max(sqrt(simd_distance(p0, p1)), 1e-4)
            let t2 = t1 + max(sqrt(simd_distance(p1, p2)), 1e-4)
            let t3 = t2 + max(sqrt(simd_distance(p2, p3)), 1e-4)
            knotSample[i] = pos.count
            let last = i == n - 2 ? per : per - 1
            for j in 0...last {
                let x = Double(j) / Double(per)
                let t = t1 + (t2 - t1) * x
                let a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
                let a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
                let a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
                let b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
                let b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
                pos.append(b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1)))
                width.append(catmull(scalar(i - 1, \.w), knots[i].w, knots[i + 1].w, scalar(i + 2, \.w), x))
                twist.append(
                    catmull(scalar(i - 1, \.twist), knots[i].twist, knots[i + 1].twist, scalar(i + 2, \.twist), x))
                boost.append(
                    catmull(scalar(i - 1, \.boost), knots[i].boost, knots[i + 1].boost, scalar(i + 2, \.boost), x))
            }
        }
        knotSample[n - 1] = pos.count - 1
        let m = pos.count

        var arc = [Double](repeating: 0, count: m)
        var tan = [SIMD3<Double>](repeating: .zero, count: m)
        var acc = 0.0
        for i in 0..<m {
            if i > 0 { acc += simd_distance(pos[i], pos[i - 1]) }
            arc[i] = acc
            tan[i] = normalized(pos[min(m - 1, i + 1)] - pos[max(0, i - 1)])
        }

        // Double-reflection rotation-minimising frame (Wang et al. 2008).
        var bin = [SIMD3<Double>](repeating: .zero, count: m)
        let seed: SIMD3<Double> = abs(tan[0].z) < 0.9 ? [0, 0, 1] : [1, 0, 0]
        bin[0] = normalized(simd_cross(seed, tan[0]))
        for i in 0..<(m - 1) {
            let v1 = pos[i + 1] - pos[i]
            let c1 = simd_dot(v1, v1)
            let r = bin[i]
            if c1 < 1e-12 {
                bin[i + 1] = r
                continue
            }
            let rL = r - v1 * (2 / c1 * simd_dot(v1, r))
            let tL = tan[i] - v1 * (2 / c1 * simd_dot(v1, tan[i]))
            let v2 = tan[i + 1] - tL
            let c2 = simd_dot(v2, v2)
            bin[i + 1] = normalized(c2 < 1e-12 ? rL : rL - v2 * (2 / c2 * simd_dot(v2, rL)))
        }

        // Spin the whole frame so the R (planar, z = 0) lies flat facing the camera.
        let ref = knotSample[alignKnot]
        let flat = normalized(simd_cross([0, 0, 1], tan[ref]))
        let phi = atan2(simd_dot(simd_cross(bin[ref], flat), tan[ref]), simd_dot(bin[ref], flat))
        let c = cos(phi), s = sin(phi)
        for i in 0..<m {
            bin[i] = normalized(bin[i] * c + simd_cross(tan[i], bin[i]) * s)
        }

        self.pos = pos
        self.tan = tan
        self.bin = bin
        self.twist = twist
        self.width = width
        self.boost = boost
        self.arc = arc
        knotArc = knotSample.map { arc[$0] }
        length = acc
    }

    /// The guide at distance `u`; past either end it carries on straight.
    func sample(_ u: Double) -> GuideSample {
        let last = pos.count - 1
        if u <= 0 { return at(0, 0, beyond: u) }
        if u >= length { return at(last, 0, beyond: u - length) }
        var lo = 0
        var hi = last
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if arc[mid] <= u { lo = mid } else { hi = mid }
        }
        let span = arc[hi] - arc[lo]
        return at(lo, (u - arc[lo]) / (span == 0 ? 1 : span), beyond: 0)
    }

    private func at(_ i: Int, _ f: Double, beyond: Double) -> GuideSample {
        let j = min(i + 1, pos.count - 1)
        var out = GuideSample()
        out.t = normalized(tan[i] + (tan[j] - tan[i]) * f)
        let b = bin[i] + (bin[j] - bin[i]) * f
        out.b = normalized(b - out.t * simd_dot(b, out.t))
        out.p = pos[i] + (pos[j] - pos[i]) * f + out.t * beyond
        out.twist = twist[i] + (twist[j] - twist[i]) * f
        out.width = width[i] + (width[j] - width[i]) * f
        out.boost = boost[i] + (boost[j] - boost[i]) * f
        return out
    }
}

private nonisolated func catmull(_ a0: Double, _ a1: Double, _ a2: Double, _ a3: Double, _ x: Double) -> Double {
    0.5 * (2 * a1 + (-a0 + a2) * x + (2 * a0 - 5 * a1 + 4 * a2 - a3) * x * x + (-a0 + 3 * a1 - 3 * a2 + a3) * x * x * x)
}

/// A zero vector stays zero rather than turning into NaNs.
nonisolated func normalized(_ a: SIMD3<Double>) -> SIMD3<Double> {
    let l = simd_length(a)
    return l > 0 ? a / l : a
}

/// The Relay R's centreline, traced off assets/relay-mark.svg (its inner coordinates): x, y, ribbon
/// width, twist in half turns, depth. The two hairpins (the bottom of the loop, the fold under the
/// bowl) roll half a turn, so the ribbon goes edge-on there the way a folded ribbon does; the bowl
/// sits a hair in front of the stem where they cross.
nonisolated enum RelayR {
    private static let mark: [[Double]] = [
        [115, 64, 1, 0, 0], [160, 116, 8, 0, 0], [198, 175, 13, 0, 0], [226, 239, 20, 0, 0],
        [245, 305, 26, 0, 0], [254, 375, 29, 0, 0], [246, 410, 26, 0.25, 0], [229, 431, 22, 0.5, 0],
        [210, 414, 26, 0.75, 0], [186, 388, 30, 1, 0], [163, 355, 33, 1, 0], [145, 320, 33, 1, 0],
        [134, 285, 31, 1, 0], [132, 256, 29, 1, 0], [143, 234, 29, 1, 2], [165, 224, 29, 1, 4],
        [205, 224, 31, 1, 4], [245, 229, 31, 1, 4], [285, 240, 30, 1, 2], [322, 251, 30, 1, 0],
        [360, 265, 29, 1, 0], [390, 279, 27, 1.2, 0], [405, 291, 24, 1.5, 0], [388, 302, 24, 1.8, 0],
        [352, 296, 25, 2, 0], [322, 298, 28, 2, 0], [300, 314, 30, 2, 0], [316, 336, 27, 2, 0],
        [340, 355, 26, 2, 0], [386, 387, 25, 2, 0], [430, 416, 23, 2, 0], [460, 437, 20, 2, 0],
        [480, 456, 17, 2, 0], [493, 476, 12, 2, 0], [497, 494, 3, 2, 0],
    ]
    private static let unit = 100.0

    static let knots: [Knot] = mark.map { k in
        Knot(p: [(k[0] - 310) / unit, -(k[1] - 285) / unit, k[4] / unit], w: k[2] * 1.12 / unit, twist: k[3] * .pi)
    }

    /// The knot the frame is aligned on: the middle of the stem.
    static let align = 4

    /// The R on its own, which sets the ribbon's widths along its length.
    static let guide = Guide(knots, align: align)

    /// Width at `s`, 0 at the R's top tip to 1 at the end of its leg.
    static func width(at s: Double) -> Double { guide.sample(s * guide.length).width }
}
