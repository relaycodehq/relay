import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision
import VisionKit

/// The camera behind the viewfinder: it reports the first code it reads, with the code's corners
/// in its view's points (top left, top right, bottom right, bottom left), then follows those corners.
protocol CodeCamera: AnyObject {
    var controller: UIViewController { get }
    /// Says whether the code is one to follow; a code it isn't, the camera doesn't report again.
    var onSeen: (SeenCode, [CGPoint]) -> Bool { get set }
    var onMoved: ([CGPoint]) -> Void { get set }
    func start() throws
    func stop()
}

enum CodeCameras {
    static var canScan: Bool {
        #if targetEnvironment(simulator)
            true
        #else
            DataScannerViewController.isSupported
        #endif
    }

    static func make() -> CodeCamera {
        #if targetEnvironment(simulator)
            StandInCamera()
        #else
            VisionCamera()
        #endif
    }
}

/// VisionKit's live scanner with its own marks off: the viewfinder's dots are the marks.
final class VisionCamera: NSObject, CodeCamera, DataScannerViewControllerDelegate {
    private let scanner = DataScannerViewController(
        recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, recognizesMultipleItems: false,
        isHighFrameRateTrackingEnabled: true, isPinchToZoomEnabled: false, isGuidanceEnabled: false,
        isHighlightingEnabled: false)
    private var followed: RecognizedItem.ID?
    private var refused = Set<RecognizedItem.ID>()
    var onSeen: (SeenCode, [CGPoint]) -> Bool = { _, _ in false }
    var onMoved: ([CGPoint]) -> Void = { _ in }
    var controller: UIViewController { scanner }

    override init() {
        super.init()
        scanner.delegate = self
    }

    func start() throws { try scanner.startScanning() }
    func stop() { scanner.stopScanning() }

    func dataScanner(_ scanner: DataScannerViewController, didAdd added: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in added {
            guard followed == nil, !refused.contains(item.id), case .barcode(let code) = item,
                let text = code.payloadStringValue
            else { continue }
            let modules = CodeModules.read(code.observation, text: text)
            if onSeen(SeenCode(text: text, size: modules.size, modules: modules.dark), Self.corners(code.bounds)) {
                followed = item.id
            } else {
                refused.insert(item.id)
            }
        }
    }

    func dataScanner(_ scanner: DataScannerViewController, didUpdate updated: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in updated where item.id == followed {
            if case .barcode(let code) = item { onMoved(Self.corners(code.bounds)) }
        }
    }

    private static func corners(_ b: RecognizedItem.Bounds) -> [CGPoint] {
        [b.topLeft, b.topRight, b.bottomRight, b.bottomLeft]
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
        private var link: CADisplayLink?
        private var started = 0.0
        private var reported = false
        var onSeen: (SeenCode, [CGPoint]) -> Bool = { _, _ in false }
        var onMoved: ([CGPoint]) -> Void = { _ in }
        var controller: UIViewController { screen }

        func start() throws {
            started = CACurrentMediaTime()
            let link = CADisplayLink(target: self, selector: #selector(step))
            link.add(to: .main, forMode: .common)
            self.link = link
        }

        func stop() {
            link?.invalidate()
            link = nil
        }

        @objc private func step() {
            let t = CACurrentMediaTime() - started
            screen.sway(t)
            guard t > 2.6 else { return }
            if !reported {
                reported = true
                let modules = CodeModules.read(screen.observation, text: screen.text)
                if !onSeen(SeenCode(text: screen.text, size: modules.size, modules: modules.dark), screen.corners) { stop() }
            } else {
                onMoved(screen.corners)
            }
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
