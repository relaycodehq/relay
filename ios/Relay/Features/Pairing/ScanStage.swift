import AVFoundation
import MetalKit
import SwiftUI

/// The field, with the camera under it while scanning. Both are drawn from one clock: the camera's
/// window and shade move in the same transaction as the frame of dots riding its edges.
struct ScanStage: UIViewControllerRepresentable {
    let scan: PairingScan
    let palette: RipplePalette
    /// The camera can't be used: no permission, or it wouldn't start.
    var cameraFailed: (String) -> Void = { _ in }

    func makeUIViewController(context: Context) -> ScanStageController {
        ScanStageController(scan: scan, palette: palette, cameraFailed: cameraFailed)
    }

    func updateUIViewController(_ controller: ScanStageController, context: Context) {
        controller.palette = palette
        controller.cameraFailed = cameraFailed
    }
}

final class ScanStageController: UIViewController {
    private let scan: PairingScan
    var cameraFailed: (String) -> Void
    var palette: RipplePalette { didSet { renderer?.palette = palette } }
    private let metal = MTKView()
    private var renderer: RippleRenderer?
    /// The camera, cut to the viewfinder's window.
    private let box = UIView()
    private let window = CAShapeLayer()
    private let shade = UIView()
    private let hole = CAShapeLayer()
    private var camera: CodeCamera?
    private var starting = false
    private var last: CFTimeInterval = 0
    private var clock = 0.0
    /// Where a dragging finger last left a ring.
    private var dragged: CGPoint?
    private let tap = UIImpactFeedbackGenerator(style: .soft)

    init(scan: PairingScan, palette: RipplePalette, cameraFailed: @escaping (String) -> Void) {
        self.scan = scan
        self.palette = palette
        self.cameraFailed = cameraFailed
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Made in code") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        box.isHidden = true
        box.backgroundColor = .black
        box.layer.mask = window
        shade.backgroundColor = .black
        shade.isUserInteractionEnabled = false
        hole.fillColor = UIColor(white: 0.04, alpha: 1).cgColor
        box.addSubview(shade)
        box.layer.addSublayer(hole)
        view.addSubview(box)

        metal.device = MTLCreateSystemDefaultDevice()
        metal.colorPixelFormat = .bgra8Unorm
        metal.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        metal.isOpaque = false
        metal.backgroundColor = .clear
        metal.preferredFramesPerSecond = 60
        metal.presentsWithTransaction = true
        metal.isUserInteractionEnabled = false
        if let layer = metal.layer as? CAMetalLayer {
            layer.isOpaque = false
            layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
        }
        view.addSubview(metal)
        guard let renderer = RippleRenderer(view: metal, palette: palette) else { return }
        renderer.frame = { [weak self] in self?.tick() }
        metal.delegate = renderer
        self.renderer = renderer
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        metal.frame = view.bounds
        box.frame = view.bounds
        shade.frame = box.bounds
        camera?.controller.view.frame = box.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        last = 0
        metal.isPaused = false
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        metal.isPaused = true
        dropCamera()
    }

    /// A finger on the field makes its own rings: one where it touches, smaller ones as it drags.
    private var touchable: Bool {
        guard !scan.reduceMotion else { return false }
        return switch scan.phase {
        case .idle, .waiting, .answering, .paired: true
        default: false
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard touchable, let point = touches.first?.location(in: view) else { return }
        dragged = point
        if renderer?.touch(at: point, in: view.bounds.size, strength: 1) == true { tap.impactOccurred(intensity: 0.6) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard touchable, let point = touches.first?.location(in: view), let from = dragged,
            hypot(point.x - from.x, point.y - from.y) > 28
        else { return }
        dragged = point
        _ = renderer?.touch(at: point, in: view.bounds.size, strength: 0.5)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { dragged = nil }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { dragged = nil }

    private func tick() -> RippleFrame? {
        let now = CACurrentMediaTime()
        let dt = last == 0 ? 1.0 / 60 : min(0.05, now - last)
        last = now
        if !scan.reduceMotion { clock += dt }
        scan.advance(dt)
        if scan.wantsCamera, camera == nil, !starting { startCamera() }
        if !scan.wantsCamera, camera != nil { dropCamera() }

        let points = SIMD2<Float>(Float(view.bounds.width), Float(view.bounds.height))
        let s = scan.scene(points: points)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        // Black until the camera's first frames, as a camera app's is.
        let showing = scan.wantsCamera && s.cameraHalf.x > 0 && s.cameraAlpha > 0
        box.isHidden = !showing
        if showing {
            box.alpha = CGFloat(s.cameraAlpha)
            shade.alpha = CGFloat(s.shade)
            let half = CGSize(width: CGFloat(s.cameraHalf.x * points.x / 2), height: CGFloat(s.cameraHalf.y * points.y / 2))
            let centre = CGPoint(x: view.bounds.midX, y: CGFloat((1 - s.window.y) * points.y / 2))
            let rect = CGRect(x: centre.x - half.width, y: centre.y - half.height, width: half.width * 2, height: half.height * 2)
            window.path = UIBezierPath(rect: rect).cgPath
            hole.path = s.lifted ? codePath(s.code, points) : nil
        }
        CATransaction.commit()
        return RippleFrame(
            time: clock, scene: s, modules: scan.code?.size ?? 0, answer: scan.takeAnswer())
    }

    /// The code's square on the screen, in points.
    private func codePath(_ code: simd_float3x3, _ points: SIMD2<Float>) -> CGPath {
        let path = UIBezierPath()
        for (i, m) in [SIMD2<Float>(0, 0), [1, 0], [1, 1], [0, 1]].enumerated() {
            let p = code * SIMD3(m, 1)
            let at = CGPoint(x: CGFloat((p.x / p.z + 1) / 2 * points.x), y: CGFloat((1 - p.y / p.z) / 2 * points.y))
            if i == 0 { path.move(to: at) } else { path.addLine(to: at) }
        }
        path.close()
        return path.cgPath
    }

    private func startCamera() {
        starting = true
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: openCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if granted { openCamera() } else { refuse() }
                }
            }
        default: refuse()
        }
    }

    private func refuse() {
        starting = false
        scan.close()
        cameraFailed("Relay can't use the camera. Allow it in Settings, or paste the pairing link instead.")
    }

    private func openCamera() {
        starting = false
        guard scan.wantsCamera else { return }
        let camera = CodeCameras.make()
        camera.onSeen = { [weak self] code, corners in
            guard let self else { return false }
            guard scan.seen(code, at: corners.map(ndc)) else { return false }
            renderer?.modules = code.modules
            return true
        }
        camera.onMoved = { [weak self] corners in
            guard let self else { return }
            scan.moved(to: corners.map(ndc))
        }
        addChild(camera.controller)
        box.insertSubview(camera.controller.view, at: 0)
        camera.controller.view.frame = box.bounds
        camera.controller.didMove(toParent: self)
        do {
            try camera.start()
            self.camera = camera
        } catch {
            camera.controller.willMove(toParent: nil)
            camera.controller.view.removeFromSuperview()
            camera.controller.removeFromParent()
            scan.close()
            cameraFailed("The camera didn't start. Paste the pairing link instead.")
        }
    }

    private func dropCamera() {
        guard let camera else { return }
        camera.stop()
        camera.controller.willMove(toParent: nil)
        camera.controller.view.removeFromSuperview()
        camera.controller.removeFromParent()
        self.camera = nil
        box.isHidden = true
    }

    private func ndc(_ p: CGPoint) -> SIMD2<Float> {
        let size = view.bounds.size
        return [Float(p.x / size.width * 2 - 1), Float(1 - p.y / size.height * 2)]
    }
}

extension RipplePalette {
    init(_ colors: RelayColors) {
        func rgb(_ color: Color) -> SIMD3<Float> {
            var c: (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) = (0, 0, 0, 0)
            UIColor(color).getRed(&c.r, green: &c.g, blue: &c.b, alpha: &c.a)
            return [Float(c.r), Float(c.g), Float(c.b)]
        }
        let accent = rgb(colors.accent)
        // Over the camera it's always dark, so a light theme's deep accent goes paler there.
        self.init(
            base: rgb(colors.muted), hot: accent,
            overCamera: colors.dark ? accent : simd_mix(accent, SIMD3(repeating: 1), SIMD3(repeating: 0.45)),
            baseAlpha: colors.dark ? 0.28 : 0.34)
    }
}
