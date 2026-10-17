import SwiftUI
import simd

/// The R as a small satin ribbon, drawn by SwiftUI rather than Metal, as Android's RibbonMesh.kt:
/// a strip along `RelayR.guide`, each slice lit with the splash shader's light (Splash.metal,
/// minus the thread detail, which a ribbon this small never shows). At this size a slice every
/// point along the ribbon is as good as lighting every pixel.
nonisolated enum RibbonMesh {
    /// Draws the stretch of the R from its top tip to `written` (0…1 of its length), `height`
    /// points tall and centred on `center`. A glint of `glint` strength sits at `glintAt` along
    /// the R.
    static func draw(
        in context: GraphicsContext, center: CGPoint, height: Double, written: Double, glintAt: Double,
        glint: Double, onWhite: Bool
    ) {
        guard written > 0, height >= 2 else { return }
        let guide = RelayR.guide
        let k = height / rHeight
        let span = guide.length * min(written, 1)
        let samples = max(16, Int((span * k).rounded()))
        let ox = center.x - centerX * k
        let oy = center.y + centerY * k
        // Each quad spans two slices, overlapping the one before, so antialiased edges leave no seam.
        var edges: [(CGPoint, CGPoint)] = []
        edges.reserveCapacity(4)
        for i in 0..<samples {
            let u = span * Double(i) / Double(samples - 1)
            let g = guide.sample(u)
            let n0 = simd_cross(g.t, g.b)
            let across = g.b * cos(g.twist) + n0 * sin(g.twist)
            let half = g.width * k / 2
            let x = ox + g.p.x * k
            let y = oy - g.p.y * k
            edges.append((
                CGPoint(x: x - across.x * half, y: y + across.y * half),
                CGPoint(x: x + across.x * half, y: y - across.y * half)
            ))
            if edges.count > 3 { edges.removeFirst() }
            guard edges.count > 1, let from = edges.first, let to = edges.last else { continue }
            var quad = Path()
            quad.move(to: from.0)
            quad.addLine(to: from.1)
            quad.addLine(to: to.1)
            quad.addLine(to: to.0)
            quad.closeSubpath()
            let color = shade(g.t, simd_cross(g.t, across), along: u / guide.length, glintAt, glint, onWhite)
            context.fill(quad, with: .color(color))
        }
    }

    /// The splash shader's satin for a camera straight ahead.
    private static func shade(
        _ t: SIMD3<Double>, _ n: SIMD3<Double>, along: Double, _ glintAt: Double, _ glint: Double, _ onWhite: Bool
    ) -> Color {
        let front = n.z >= 0
        let normal = simd_normalize(front ? n : -n)
        let ndl = max(simd_dot(normal, light1), 0)
        let wrap = ndl * 0.75 + 0.25
        var col =
            front
            ? mix(mix(deep, lilac, smooth(0, 0.72, wrap)), pale, smooth(0.7, 1, wrap))
            : mix(deep * 0.6, lilac * 0.66, smooth(0.1, 1, wrap))
        // The shader darkens the edges; across a strip two vertices wide that averages out to this.
        col *= (onWhite ? 0.8 : 1) * 0.98
        let s1 = sheen(t, half1, front ? 70 : 10) * (front ? 0.95 : 0.1) * smooth(0, 0.25, ndl)
        let s2 = sheen(t, half2, 48) * (front ? 0.26 : 0.05)
        let shine = onWhite ? 0.55 : 1
        // The straight-ahead view reflected about the normal, against the soft box overhead.
        let reflected = SIMD3(2 * normal.z * normal.x, 2 * normal.z * normal.y, 2 * normal.z * normal.z - 1)
        let env = smooth(0.4, 1, simd_dot(reflected, box))
        col += shine * (s1 * sheen1 + s2 * sheen2) + env * (front ? 0.18 : 0.04) * envColor
        // Soft shoulder: sheen piles up into white otherwise.
        let over = simd_max(col - 0.86, .zero)
        col = simd_min(col, SIMD3(repeating: 0.86)) + over / (1 + over * 7)
        let g = exp(-pow((along - glintAt) / 0.035, 2)) * glint
        col += g * (front ? glintFront : glintBack)
        col = simd_clamp(col, .zero, SIMD3(repeating: 1))
        return Color(red: col.x, green: col.y, blue: col.z)
    }

    private static func sheen(_ t: SIMD3<Double>, _ h: SIMD3<Double>, _ power: Double) -> Double {
        let d = simd_dot(t, h)
        return pow(max(0, 1 - d * d).squareRoot(), power)
    }

    private static func mix(_ a: SIMD3<Double>, _ b: SIMD3<Double>, _ x: Double) -> SIMD3<Double> { a + (b - a) * x }

    private static func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let t = min(max((x - a) / (b - a), 0), 1)
        return t * t * (3 - 2 * t)
    }

    /// The R's height in world units (relay-mark.svg y 64…494) and its middle.
    private static let rHeight = 4.30
    private static let centerX = -0.04
    private static let centerY = 0.06

    private static let deep = SIMD3(0.42, 0.38, 0.6)
    private static let lilac = SIMD3(0.79, 0.75, 0.96)
    private static let pale = SIMD3(0.96, 0.945, 1.0)
    private static let sheen1 = SIMD3(1.0, 0.985, 1.0)
    private static let sheen2 = SIMD3(0.7, 0.62, 1.0)
    private static let envColor = SIMD3(0.95, 0.93, 1.0)
    private static let glintFront = SIMD3(0.6, 0.58, 0.66)
    private static let glintBack = SIMD3(0.28, 0.26, 0.34)

    private static let view = SIMD3(0.0, 0.0, 1.0)
    private static let light1 = simd_normalize(SIMD3(-0.45, 0.7, 0.6))
    private static let half1 = simd_normalize(light1 + view)
    private static let half2 = simd_normalize(simd_normalize(SIMD3(0.75, -0.35, 0.35)) + view)
    private static let box = simd_normalize(SIMD3(-0.3, 0.85, 0.45))
}
