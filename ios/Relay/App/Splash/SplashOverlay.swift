import MetalKit
import SwiftUI

/// Whether the splash is still up, and the app's scale under it.
@Observable final class SplashState {
    var showing = true
    var appScale = PullSplash.appScaleFrom

    func finish() {
        showing = false
        appScale = 1
    }
}

/// The app under the launch splash, as on Android: the launch screen's R gets its leg yanked,
/// the ribbon unthreads and whips past the camera, wiping the splash away, and the app settles
/// from a hair larger. Only a cold launch shows it; going to the background mid-pull ends it.
struct SplashHost<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var splash = SplashState()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ZStack {
            content.scaleEffect(splash.appScale)
            if splash.showing {
                SplashOverlay(splash: splash)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
        .onChange(of: phase) { _, now in
            if now == .background { splash.finish() }
        }
    }
}

private struct SplashOverlay: UIViewRepresentable {
    let splash: SplashState

    func makeUIView(context: Context) -> SplashView { SplashView(splash: splash) }
    func updateUIView(_ view: SplashView, context: Context) {}
}

/// The launch screen's still, then the pull drawn over it with Metal. The still stays until
/// Metal has drawn the same frame, so the launch screen hands over without a seam.
final class SplashView: UIView {
    private let splash: SplashState
    private let still = UIView()
    private let mark = UIImageView()
    private var metal: MTKView?
    private var renderer: SplashRenderer?
    private var started = false

    init(splash: SplashState) {
        self.splash = splash
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        addSubview(still)
        still.addSubview(mark)
    }

    required init?(coder: NSCoder) { fatalError("Made in code") }

    override func layoutSubviews() {
        super.layoutSubviews()
        still.frame = bounds
        metal?.frame = bounds
        let side = PullSplash.iconPoints
        mark.frame = CGRect(x: bounds.midX - side / 2, y: bounds.midY - side / 2, width: side, height: side)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard let window, !started else { return }
        started = true
        // The launch screen's look: the system's light or dark, whatever the app turns to after.
        let traits = window.windowScene?.screen.traitCollection ?? traitCollection
        let background = (UIColor(named: "LaunchBackground") ?? .black).resolvedColor(with: traits)
        still.backgroundColor = background
        mark.image = UIImage(named: "LaunchMark", in: nil, compatibleWith: traits)

        guard !UIAccessibility.isReduceMotionEnabled else { return fadeOut() }
        let view = MTKView(frame: bounds, device: MTLCreateSystemDefaultDevice())
        view.colorPixelFormat = .bgra8Unorm
        view.depthStencilPixelFormat = .depth32Float
        view.sampleCount = view.device?.supportsTextureSampleCount(4) == true ? 4 : 1
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.preferredFramesPerSecond = 120
        if let layer = view.layer as? CAMetalLayer {
            layer.isOpaque = false
            // The still is sRGB; so are the shaders' colours, as on Android.
            layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
        }
        var rgb: (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) = (0, 0, 0, 0)
        background.getRed(&rgb.r, green: &rgb.g, blue: &rgb.b, alpha: &rgb.a)
        guard
            let renderer = SplashRenderer(
                view: view, background: [Float(rgb.r), Float(rgb.g), Float(rgb.b)],
                spot: { [unowned view] in
                    // The launch screen centres the still on the screen at its point size.
                    let size = view.drawableSize
                    let scale = view.bounds.width > 0 ? Double(size.width / view.bounds.width) : 1
                    return IconSpot(center: [size.width / 2, size.height / 2], size: PullSplash.iconPoints * scale)
                })
        else { return fadeOut() }
        renderer.onCovering = { [weak self] in self?.still.isHidden = true }
        renderer.onFrame = { [weak self] frame in
            guard let self else { return }
            splash.appScale = frame.appScale
            if frame.done { finish() }
        }
        view.delegate = renderer
        self.renderer = renderer
        metal = view
        addSubview(view)
        // Added before the first layout, at no size: an MTKView without a drawable never draws.
        setNeedsLayout()
        // A GPU that never draws a frame mustn't leave the splash up.
        DispatchQueue.main.asyncAfter(deadline: .now() + PullSplash.duration + 2) { [weak self] in self?.finish() }
    }

    /// No pull: the still fades into the app.
    private func fadeOut() {
        splash.appScale = 1
        UIView.animate(withDuration: 0.25, delay: 0.05, options: .curveEaseOut) {
            self.still.alpha = 0
        } completion: { _ in
            self.finish()
        }
    }

    private func finish() {
        metal?.isPaused = true
        metal?.delegate = nil
        splash.finish()
    }
}
