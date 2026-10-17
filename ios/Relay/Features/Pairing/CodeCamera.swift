import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Metal
import UIKit
import os
import Vision

/// One picture from the camera, upright, and what backs it, kept alive while the GPU reads it.
nonisolated struct CameraFrame: @unchecked Sendable {
    let texture: MTLTexture
    let backing: AnyObject?
}

/// The camera behind the field: its pictures go to the renderer, which draws them in dots, and it
/// reports the first code it reads with the code's corners in the stage's points (top left, top
/// right, bottom right, bottom left), then follows those corners.
protocol CodeCamera: AnyObject {
    /// The newest picture; nil until the first.
    var latest: CameraFrame? { get }
    /// Says whether the code is one to follow; a code it isn't, the camera doesn't report again.
    var onSeen: (SeenCode, [CGPoint]) -> Bool { get set }
    var onMoved: ([CGPoint]) -> Void { get set }
    var onFailed: () -> Void { get set }
    /// The size in points the picture fills, as a camera app's does; the corners are in it.
    var stage: CGSize { get set }
    func start()
    func stop()
}

enum CodeCameras {
    static var canScan: Bool {
        #if targetEnvironment(simulator)
            true
        #else
            LiveCamera.device() != nil
        #endif
    }

    static func make(_ device: MTLDevice) -> CodeCamera {
        #if targetEnvironment(simulator)
            StandInCamera(device)
        #else
            LiveCamera(device)
        #endif
    }

    /// Where a point of the picture (0..1, from its bottom left, as Vision gives it) shows on a
    /// stage the picture fills.
    static func onStage(_ p: CGPoint, image: CGSize, stage: CGSize) -> CGPoint {
        let s = max(stage.width / image.width, stage.height / image.height)
        return CGPoint(
            x: (p.x - 0.5) * image.width * s + stage.width / 2, y: (0.5 - p.y) * image.height * s + stage.height / 2)
    }
}

/// The back camera, read for QR codes with Vision.
final class LiveCamera: CodeCamera {
    private let feed: CameraFeed
    private var followed: String?
    private var refused = Set<String>()
    var onSeen: (SeenCode, [CGPoint]) -> Bool = { _, _ in false }
    var onMoved: ([CGPoint]) -> Void = { _ in }
    var onFailed: () -> Void = {}
    var stage = CGSize.zero
    var latest: CameraFrame? { feed.latest }

    /// The camera to scan with. One made of several hands over to the ultra wide for a code held
    /// closer than the wide one can focus.
    static func device() -> AVCaptureDevice? {
        for kind in [AVCaptureDevice.DeviceType.builtInTripleCamera, .builtInDualWideCamera, .builtInWideAngleCamera] {
            if let device = AVCaptureDevice.default(kind, for: .video, position: .back) { return device }
        }
        return nil
    }

    init(_ device: MTLDevice) {
        feed = CameraFeed(device)
        feed.sighted = { [weak self] sighting in
            Task { @MainActor in self?.sighted(sighting) }
        }
        feed.failed = { [weak self] in
            Task { @MainActor in self?.onFailed() }
        }
    }

    func start() {
        guard let device = Self.device() else { return onFailed() }
        feed.start(device)
    }

    func stop() { feed.stop() }

    private func sighted(_ s: CameraFeed.Sighting) {
        let code = s.observation
        guard let text = code.payloadStringValue, !refused.contains(text), stage.width > 0 else { return }
        let corners = [code.topLeft, code.topRight, code.bottomRight, code.bottomLeft].map {
            CodeCameras.onStage($0, image: s.image, stage: stage)
        }
        if let followed {
            if followed == text { onMoved(corners) }
            return
        }
        let modules = CodeModules.read(code, text: text)
        if onSeen(SeenCode(text: text, size: modules.size, modules: modules.dark), corners) {
            followed = text
        } else {
            refused.insert(text)
        }
    }
}

/// The capture session, off the main thread: each picture becomes a Metal texture, and Vision
/// looks for a code in as many of them as it keeps up with.
private nonisolated final class CameraFeed: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    struct Sighting: @unchecked Sendable {
        let observation: VNBarcodeObservation
        /// The picture's size in pixels.
        let image: CGSize
    }

    private let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let pictures = DispatchQueue(label: "dev.relay.camera")
    private let reading = DispatchQueue(label: "dev.relay.camera.read", qos: .userInitiated)
    private var cache: CVMetalTextureCache?
    private let newest = OSAllocatedUnfairLock<CameraFrame?>(initialState: nil)
    private let busy = OSAllocatedUnfairLock(initialState: false)
    var sighted: @Sendable (Sighting) -> Void = { _ in }
    var failed: @Sendable () -> Void = {}

    var latest: CameraFrame? { newest.withLock { $0 } }

    init(_ device: MTLDevice) {
        super.init()
        CVMetalTextureCacheCreate(nil, nil, device, nil, &cache)
    }

    func start(_ device: AVCaptureDevice) {
        pictures.async { [self] in
            do {
                try configure(device)
                session.startRunning()
            } catch {
                failed()
            }
        }
    }

    func stop() {
        pictures.async { [self] in
            session.stopRunning()
            newest.withLock { $0 = nil }
        }
    }

    private func configure(_ device: AVCaptureDevice) throws {
        guard session.inputs.isEmpty else { return }
        let input = try AVCaptureDeviceInput(device: device)
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .hd1920x1080
        guard session.canAddInput(input), session.canAddOutput(output) else { throw CocoaError(.featureUnsupported) }
        session.addInput(input)
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: pictures)
        session.addOutput(output)
        if let connection = output.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90
        }
        try device.lockForConfiguration()
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
        // Framed as the wide camera's 1x, so the system can go wider for a close code.
        if let wide = device.virtualDeviceSwitchOverVideoZoomFactors.first { device.videoZoomFactor = CGFloat(truncating: wide) }
        device.unlockForConfiguration()
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixels = CMSampleBufferGetImageBuffer(sample), let cache else { return }
        let w = CVPixelBufferGetWidth(pixels), h = CVPixelBufferGetHeight(pixels)
        var made: CVMetalTexture?
        CVMetalTextureCacheCreateTextureFromImage(nil, cache, pixels, nil, .bgra8Unorm, w, h, 0, &made)
        if let made, let texture = CVMetalTextureGetTexture(made) {
            let frame = CameraFrame(texture: texture, backing: made)
            newest.withLock { $0 = frame }
        }
        guard busy.withLock({ was in defer { was = true }; return !was }) else { return }
        let image = CGSize(width: w, height: h)
        nonisolated(unsafe) let held = pixels
        reading.async { [self] in
            defer { busy.withLock { $0 = false } }
            let request = VNDetectBarcodesRequest()
            request.symbologies = [.qr]
            try? VNImageRequestHandler(cvPixelBuffer: held, orientation: .up).perform([request])
            if let code = request.results?.first(where: { $0.payloadStringValue != nil }) {
                sighted(Sighting(observation: code, image: image))
            }
        }
    }
}

/// The code's modules. Vision says how the code was made (version, mask, error correction), so
/// drawing it again from that gives the very modules the camera saw; without that, the text
/// drawn the way the desktop draws it.
enum CodeModules {
    static func read(_ observation: VNBarcodeObservation?, text: String) -> (size: Int, dark: [UInt8]) {
        if let descriptor = observation?.barcodeDescriptor as? CIQRCodeDescriptor {
            let generator = CIFilter.barcodeGenerator()
            generator.barcodeDescriptor = descriptor
            if let read = modules(generator.outputImage) { return read }
        }
        let generator = CIFilter.qrCodeGenerator()
        generator.message = Data(text.utf8)
        generator.correctionLevel = "M"
        return modules(generator.outputImage) ?? (0, [])
    }

    /// A module to a pixel inside a quiet zone, which ends where the top left finder starts.
    private static func modules(_ image: CIImage?) -> (size: Int, dark: [UInt8])? {
        guard let image, let picture = CIContext().createCGImage(image, from: image.extent) else { return nil }
        let w = picture.width, h = picture.height
        guard w == h, w > 21 else { return nil }
        var pixels = [UInt8](repeating: 255, count: w * h)
        let drawn = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard
                let context = CGContext(
                    data: bytes.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
            else { return false }
            context.draw(picture, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn, let quiet = (0..<w / 2).first(where: { pixels[$0 * w + $0] < 128 }) else { return nil }
        let size = w - 2 * quiet
        guard size >= 21, (size - 17) % 4 == 0 else { return nil }
        var dark = [UInt8](repeating: 0, count: size * size)
        for y in 0..<size {
            for x in 0..<size where pixels[(y + quiet) * w + x + quiet] < 128 { dark[y * size + x] = 1 }
        }
        return (size, dark)
    }
}

#if targetEnvironment(simulator)
    /// The Simulator has no camera: a computer screen showing a code, held in a slightly unsteady
    /// hand, that "reads" it after a moment. The code holds `RELAY_STANDIN_PAIR` when it's set
    /// (`SIMCTL_CHILD_RELAY_STANDIN_PAIR=… xcrun simctl launch`), so the fixture desktop pairs it.
    final class StandInCamera: CodeCamera {
        private let screen = StandInScreen()
        private let device: MTLDevice
        /// Drawn in turn, so a picture isn't drawn over while the GPU still reads it.
        private var textures: [MTLTexture] = []
        private var next = 0
        private var link: CADisplayLink?
        private var started = 0.0
        private var reported = false
        private var following = false
        private(set) var latest: CameraFrame?
        var onSeen: (SeenCode, [CGPoint]) -> Bool = { _, _ in false }
        var onMoved: ([CGPoint]) -> Void = { _ in }
        var onFailed: () -> Void = {}
        var stage = CGSize.zero

        init(_ device: MTLDevice) { self.device = device }

        func start() {
            started = CACurrentMediaTime()
            let link = CADisplayLink(target: self, selector: #selector(step))
            link.add(to: .main, forMode: .common)
            self.link = link
        }

        func stop() {
            link?.invalidate()
            link = nil
            latest = nil
        }

        @objc private func step() {
            guard stage.width > 0 else { return }
            let t = CACurrentMediaTime() - started
            screen.view.frame = CGRect(origin: .zero, size: stage)
            screen.sway(t)
            // A camera takes a moment to give its first picture.
            if t > 0.25 { latest = picture() }
            guard t > 2.6 else { return }
            if !reported {
                reported = true
                let modules = CodeModules.read(screen.observation, text: screen.text)
                following = onSeen(SeenCode(text: screen.text, size: modules.size, modules: modules.dark), screen.corners)
            } else if following {
                onMoved(screen.corners)
            }
        }

        /// The screen drawn into the next texture, two pixels a point.
        private func picture() -> CameraFrame? {
            let w = Int(stage.width * 2), h = Int(stage.height * 2)
            if textures.first?.width != w || textures.first?.height != h {
                let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
                d.usage = .shaderRead
                textures = (0..<3).compactMap { _ in device.makeTexture(descriptor: d) }
            }
            guard textures.count == 3,
                let context = CGContext(
                    data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
                let data = context.data
            else { return nil }
            context.translateBy(x: 0, y: CGFloat(h))
            context.scaleBy(x: 2, y: -2)
            screen.view.layer.render(in: context)
            next = (next + 1) % 3
            let texture = textures[next]
            texture.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: data, bytesPerRow: w * 4)
            return CameraFrame(texture: texture, backing: nil)
        }
    }

    private final class StandInScreen: UIViewController {
        let text = ProcessInfo.processInfo.environment["RELAY_STANDIN_PAIR"] ?? "https://example.com/not-a-pairing-code"
        private let panel = UIView()
        private let card = UIView()
        private let code = UIImageView()
        private(set) var observation: VNBarcodeObservation?

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = UIColor(red: 0.09, green: 0.08, blue: 0.08, alpha: 1)
            panel.backgroundColor = UIColor(red: 0.16, green: 0.16, blue: 0.18, alpha: 1)
            panel.layer.cornerRadius = 14
            card.backgroundColor = .white
            card.layer.cornerRadius = 16
            let generator = CIFilter.qrCodeGenerator()
            generator.message = Data(text.utf8)
            generator.correctionLevel = "M"
            if let image = generator.outputImage, let picture = CIContext().createCGImage(image, from: image.extent) {
                code.image = UIImage(cgImage: picture)
                code.layer.magnificationFilter = .nearest
                let request = VNDetectBarcodesRequest()
                request.symbologies = [.qr]
                let scaled = CIContext().createCGImage(image.transformed(by: .init(scaleX: 8, y: 8)), from: image.extent.applying(.init(scaleX: 8, y: 8)))
                try? VNImageRequestHandler(cgImage: scaled ?? picture).perform([request])
                observation = request.results?.first
            }
            view.addSubview(panel)
            panel.addSubview(card)
            card.addSubview(code)
        }

        func sway(_ t: Double) {
            let b = view.bounds
            // Brought round to the code over the first two seconds, then a hand's small drift.
            let settle = min(1, t / 2)
            let e = settle * settle * (3 - 2 * settle)
            let dx = (1 - e) * 120 + 6 * sin(t * 1.3), dy = (1 - e) * -90 + 5 * sin(t * 1.7 + 1)
            panel.frame = CGRect(x: -60 + dx, y: b.height * 0.18 + dy, width: b.width + 120, height: b.height * 0.5)
            let side = 230.0
            card.frame = CGRect(x: panel.bounds.midX - side / 2, y: b.height * 0.26 - side / 2, width: side, height: side)
            code.frame = card.bounds.insetBy(dx: 18, dy: 18)
        }

        /// The modules' square, inside the picture's quiet zone.
        var corners: [CGPoint] {
            guard let picture = code.image?.cgImage else { return [] }
            let size = CodeModules.read(nil, text: text).size
            let r = code.convert(code.bounds, to: view)
            let s = r.insetBy(dx: r.width * Double(picture.width - size) / 2 / Double(picture.width), dy: r.height * Double(picture.width - size) / 2 / Double(picture.width))
            return [CGPoint(x: s.minX, y: s.minY), CGPoint(x: s.maxX, y: s.minY), CGPoint(x: s.maxX, y: s.maxY), CGPoint(x: s.minX, y: s.maxY)]
        }
    }
#endif
