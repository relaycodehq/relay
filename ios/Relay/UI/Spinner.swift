import SwiftUI
import UIKit

/// Relay's spinner, as the desktop and Android draw it: an arc going round a faint track.
/// Core Animation turns it on the render server at the display's own rate, up to ProMotion's
/// 120Hz, so it costs the app nothing per frame.
struct Spinner: View {
    var size: CGFloat = 16
    /// The theme's muted text colour unless given.
    var color: Color?
    @Environment(\.colors) private var colors

    var body: some View {
        SpinningArc(color: UIColor(color ?? colors.muted), line: min(2, max(1.5, size / 9)))
            .frame(width: size, height: size)
            // A UIKit view has no baseline: sit it where a glyph of its size would, beside text.
            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + size * 0.35 }
            .alignmentGuide(.lastTextBaseline) { $0[VerticalAlignment.center] + size * 0.35 }
            .accessibilityElement()
            .accessibilityLabel("Loading")
    }
}

extension Spinner {
    /// Centred in whatever room a loading screen or list leaves.
    static var page: some View { Spinner(size: 26).frame(maxWidth: .infinity, maxHeight: .infinity) }
}

private struct SpinningArc: UIViewRepresentable {
    let color: UIColor
    let line: CGFloat

    func makeUIView(context: Context) -> ArcView { ArcView() }

    func updateUIView(_ view: ArcView, context: Context) {
        view.track.strokeColor = color.withAlphaComponent(0.2).cgColor
        view.arc.strokeColor = color.cgColor
        view.track.lineWidth = line
        view.arc.lineWidth = line
        view.setNeedsLayout()
    }
}

private final class ArcView: UIView {
    let track = CAShapeLayer()
    let arc = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        for shape in [track, arc] {
            shape.fillColor = nil
            shape.lineCap = .round
            layer.addSublayer(shape)
        }
        // A quarter and a bit of the way round, as Android's 100°.
        arc.strokeEnd = 100 / 360
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let inset = track.lineWidth / 2
        let rect = bounds.insetBy(dx: inset, dy: inset)
        let path = UIBezierPath(
            arcCenter: CGPoint(x: rect.midX, y: rect.midY), radius: min(rect.width, rect.height) / 2,
            startAngle: -.pi / 2, endAngle: .pi * 1.5, clockwise: true
        ).cgPath
        for shape in [track, arc] {
            shape.frame = bounds
            shape.path = path
        }
    }

    // A layer's animations go when it leaves the window, and come back with it.
    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, arc.animation(forKey: "spin") == nil else { return }
        let spin = CABasicAnimation(keyPath: "transform.rotation.z")
        spin.fromValue = 0
        spin.toValue = 2 * Double.pi
        spin.duration = 0.8
        spin.repeatCount = .infinity
        spin.isRemovedOnCompletion = false
        spin.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        arc.add(spin, forKey: "spin")
    }
}
