import SwiftUI

/// Marks the words that shine while their call runs: a row's verb.
nonisolated struct Shining: TextAttribute {}

/// A narrow highlight band crossing muted words, as the desktop's `.live-shine`: a running call's one
/// moving part. It keeps going under Reduce Motion, as the desktop's working indicators do: with the
/// trace open, nothing else says the call is still at it.
nonisolated struct ShineBand {
    /// How far through its sweep the band is, 0 to 1.
    let phase: Double
    let highlight: Color

    private static let width = 72.0
    private static let sweep = 2.2
    /// 20 places a second, the desktop's step rate: a smooth sweep would redraw every display refresh.
    static let step = 0.05

    init(at date: Date, highlight: Color) {
        phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: Self.sweep) / Self.sweep
        self.highlight = highlight
    }

    /// The run as it is, with the band laid over its glyphs alone.
    func draw(_ run: Text.Layout.Run, in context: inout GraphicsContext) {
        let bounds = run.typographicBounds.rect
        let x = bounds.minX - Self.width + (bounds.width + Self.width) * phase
        let band = Gradient(colors: [highlight.opacity(0), highlight, highlight.opacity(0)])
        context.drawLayer { layer in
            layer.draw(run)
            layer.blendMode = .sourceAtop
            layer.fill(
                Path(CGRect(x: x, y: bounds.minY, width: Self.width, height: bounds.height)),
                with: .linearGradient(band, startPoint: CGPoint(x: x, y: 0), endPoint: CGPoint(x: x + Self.width, y: 0)))
        }
    }
}

/// Every word of the text shines while its call runs: a tool call's label. No band draws it as it is.
nonisolated struct ShiningText: TextRenderer {
    let band: ShineBand?

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            guard let band else {
                context.draw(line)
                continue
            }
            for run in line { band.draw(run, in: &context) }
        }
    }
}

/// Moves the band while `running`; otherwise draws its content once, with no band.
struct ShineClock<Content: View>: View {
    let running: Bool
    @ViewBuilder let content: (ShineBand?) -> Content
    @Environment(\.colors) private var colors

    var body: some View {
        if running {
            TimelineView(.periodic(from: .now, by: ShineBand.step)) { context in
                content(ShineBand(at: context.date, highlight: colors.foreground))
            }
        } else {
            content(nil)
        }
    }
}
