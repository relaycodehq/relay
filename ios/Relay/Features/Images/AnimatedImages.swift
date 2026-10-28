import ImageIO
import SwiftUI
import UIKit

/// GIFs as animated `UIImage`s: `UIImage(data:)` keeps only the first frame.
nonisolated enum AnimatedImages {
    /// The most bytes a GIF's decoded frames take; past it, they're decoded smaller.
    private static let budget = 64 << 20

    static func isGif(_ data: Data) -> Bool {
        data.starts(with: Array("GIF87a".utf8)) || data.starts(with: Array("GIF89a".utf8))
    }

    /// The GIF's frames at most `max` pixels on a side, each shown for as long as it asks;
    /// nil if it has fewer than two frames.
    static func decode(_ data: Data, max: Int?) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0
        else { return nil }
        let long = Swift.max(width, height)
        let fits = Double(budget) / Double(count * width * height * 4)
        let side = Swift.min(long, max ?? long, Int(Double(long) * Swift.min(fits.squareRoot(), 1)))
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Swift.max(side, 1),
        ]
        var frames: [UIImage] = []
        var delays: [Double] = []
        for index in 0..<count {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, index, options as CFDictionary) else { continue }
            frames.append(UIImage(cgImage: frame))
            delays.append(delay(source, index))
        }
        guard frames.count > 1 else { return frames.first }
        // UIImage plays every frame for as long; a frame that asks for longer is repeated.
        let unit = delays.min() ?? 0.1
        let repeated = zip(frames, delays).flatMap { frame, delay in
            Array(repeating: frame, count: Swift.max(1, Int((delay / unit).rounded())))
        }
        return UIImage.animatedImage(with: repeated, duration: unit * Double(repeated.count))
    }

    /// How long a frame shows; browsers play a frame asking for under 20ms at 100ms, and so does this.
    private static func delay(_ source: CGImageSource, _ index: Int) -> Double {
        let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
        let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
        let asked = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double)
            ?? (gif?[kCGImagePropertyGIFDelayTime] as? Double)
            ?? 0
        return asked < 0.02 ? 0.1 : asked
    }

    /// Bytes its decoded frames take, a repeated frame counted once.
    static func cost(_ image: UIImage) -> Int {
        let frames = image.images.map { Set($0.map(ObjectIdentifier.init)).count } ?? 1
        let size = image.size
        return Int(size.width * size.height * image.scale * image.scale * 4) * frames
    }
}

/// A picture that plays if it's a GIF; SwiftUI's `Image` shows only an animated image's first frame.
struct Picture: View {
    let image: UIImage
    var mode: ContentMode = .fit

    var body: some View {
        if image.images != nil {
            // A UIKit view takes the touch; this way the button it sits in gets the tap.
            Color.clear
                .contentShape(.rect)
                .overlay { AnimatedPicture(image: image, mode: mode).allowsHitTesting(false) }
        } else {
            Image(uiImage: image).resizable().aspectRatio(contentMode: mode)
        }
    }
}

private struct AnimatedPicture: UIViewRepresentable {
    let image: UIImage
    let mode: ContentMode

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.clipsToBounds = true
        // Sized by SwiftUI, never by the picture's own size.
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        if view.image !== image { view.image = image }
        view.contentMode = mode == .fill ? .scaleAspectFill : .scaleAspectFit
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIImageView, context: Context) -> CGSize? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return nil }
        let width = proposal.width ?? size.width
        let height = proposal.height ?? width * size.height / size.width
        return CGSize(width: width, height: height)
    }
}
