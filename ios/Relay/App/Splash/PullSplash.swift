import Foundation

/// Where the ribbon is and what the splash looks like at a moment of the pull.
nonisolated struct PullFrame {
    /// Guide distance of the ribbon's tail; its head is at tail + `PullSplash.span`.
    var tail = 0.0
    var ribbon = true
    var wake = false
    var backdrop: Float = 1
    var appScale = PullSplash.appScaleFrom
    var done = false
}

/// The splash's exit, as on Android: the R the launch screen showed gets its leg yanked, the
/// ribbon unthreads itself out of the R along the guide and whips past the camera. The splash is
/// cut away exactly where the ribbon has been, at its own width: an R-shaped window as it
/// unthreads, then its path, then the lens it flies through. What it never touched clears while
/// it fills the lens. Times are seconds since the overlay's first moving frame.
nonisolated enum PullSplash {
    /// World units from the camera to the R; the exit's flight is laid out around it.
    static let cameraDistance = 40.0

    /// The launch still (LaunchMark, Android's splash_mark.png) is `iconPixels` square and draws
    /// one world unit as `unitPixels`; android/tools/splash-icon/render.mjs uses the same numbers.
    static let iconPixels = 1152.0
    static let unitPixels = 118.0
    /// The still's size on screen, as the launch screen shows it: Android's splash icon size.
    static let iconPoints = 288.0

    static let appScaleFrom = 1.045
    private static let hold = 0.06
    /// Stretches the whole pull; the browser prototype's 1.0 felt rushed, and so did 1.3.
    private static let pace = 1.625
    private static let pull = 0.98 * pace
    static let duration = hold + 1.06 * pace

    private static func knot(_ x: Double, _ y: Double, _ z: Double, _ halfTurns: Double, _ boost: Double = 1)
        -> Knot
    {
        Knot(p: [x, y, z], w: 0.27, twist: halfTurns * .pi, boost: boost)
    }

    private static let exit = [
        knot(2.0, -2.95, 0.3, 2.0),
        knot(2.6, -4.3, 1.4, 2.4, 1.1),
        knot(4.3, -4.6, 4.5, 3.2, 1.4),
        knot(4.4, -0.8, 9.0, 4.2, 1.8),
        knot(0.6, 3.6, 14.0, 5.2, 2.2),
        knot(-3.4, 1.6, 20.0, 6.2, 2.5),
        knot(-2.4, -2.4, 27.0, 7.0, 2.6),
        knot(0.4, -1.2, 34.0, 7.8, 2.6),
        knot(0.15, 0.1, 40.4, 8.3, 2.6),
        knot(-0.5, 0.9, 48.0, 8.8, 2.6),
        knot(-1.6, 1.8, 62.0, 9.4, 2.6),
        knot(-2.5, 2.4, 76.0, 10.0, 2.6),
    ]

    static let guide = Guide(RelayR.knots + exit, align: RelayR.align)

    /// The ribbon's length: the R, from its top tip to the end of its leg.
    static let span = guide.knotArc[RelayR.knots.count - 1]

    static func frame(_ t: Double) -> PullFrame {
        var out = PullFrame()
        let q = progress(t, hold, hold + pull)
        // A tiny tug back into the knot before the yank.
        let tug = q < 0.14 ? -0.1 * sin(.pi * q / 0.14) : 0
        out.tail = (guide.length - span) * pow(q, 2.7) + tug
        out.ribbon = t < duration
        out.wake = t >= hold
        out.backdrop = Float(1 - smooth(t, hold + 0.80 * pace, hold + 0.87 * pace))
        let settle = progress(t, hold + 0.36 * pace, duration)
        out.appScale = appScaleFrom - (appScaleFrom - 1) * (1 - pow(1 - settle, 3))
        out.done = t >= duration
        return out
    }

    private static func progress(_ t: Double, _ a: Double, _ b: Double) -> Double {
        min(max((t - a) / (b - a), 0), 1)
    }

    private static func smooth(_ t: Double, _ a: Double, _ b: Double) -> Double {
        let x = progress(t, a, b)
        return x * x * (3 - 2 * x)
    }
}
