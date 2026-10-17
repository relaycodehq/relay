import PhotosUI
import RelayRemote
import SwiftUI

/// A photo picked for the next message, with a small copy for the composer.
struct PickedPhoto: Identifiable, Sendable {
    let id = UUID()
    let image: PastedImage
    let thumbnail: UIImage
}

/// Tried in turn until the photo fits the desktop's limit: long side in pixels, JPEG quality.
private nonisolated let steps: [(side: CGFloat, quality: CGFloat)] = [(1600, 0.8), (1280, 0.7), (1024, 0.6), (800, 0.5)]

/// The picked photo as a JPEG the desktop takes; nil when it isn't an image.
@concurrent
nonisolated func pickedPhoto(_ item: PhotosPickerItem, name: String) async throws -> PickedPhoto? {
    guard let data = try await item.loadTransferable(type: Data.self), let original = UIImage(data: data) else {
        return nil
    }
    return pickedPhoto(original, name: name)
}

/// A photo from the camera or the clipboard, as small as the desktop needs; nil when it can't fit.
nonisolated func pickedPhoto(_ original: UIImage, name: String) -> PickedPhoto? {
    for step in steps {
        let scaled = scale(original, longSide: step.side)
        guard let jpeg = scaled.jpegData(compressionQuality: step.quality) else { continue }
        let image = PastedImage(name: name, mimeType: "image/jpeg", data: jpeg)
        if image.dataUrl.count <= PastedImage.maxDataURL {
            return PickedPhoto(image: image, thumbnail: scale(scaled, longSide: 168))
        }
    }
    return nil
}

private nonisolated func scale(_ image: UIImage, longSide: CGFloat) -> UIImage {
    let size = image.size
    let factor = min(1, longSide / max(size.width, size.height))
    let target = CGSize(width: (size.width * factor).rounded(), height: (size.height * factor).rounded())
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: target, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: target))
    }
}

/// The photos going with the next message, each with a way to take it back out, and the
/// screenshots the computer's composer has in this draft, which go with it from there.
struct PhotoStrip: View {
    let photos: [PickedPhoto]
    let loading: Int
    var computerShots: [Int] = []
    let remove: (PickedPhoto.ID) -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(photos) { photo in
                    Image(uiImage: photo.thumbnail)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: 12))
                        .overlay(alignment: .topTrailing) {
                            Button("Remove photo", systemImage: "xmark.circle.fill") { remove(photo.id) }
                                .labelStyle(.iconOnly)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.55))
                                .font(.system(size: 18))
                                .buttonStyle(.plain)
                                .padding(3)
                        }
                }
                ForEach(0..<loading, id: \.self) { _ in
                    ProgressView()
                        .frame(width: 56, height: 56)
                        .background(.quietFill, in: .rect(cornerRadius: 12))
                }
                ForEach(computerShots, id: \.self) { n in
                    VStack(spacing: 2) {
                        Image(systemName: "laptopcomputer").font(.system(size: 15))
                        Text("On computer").font(.system(size: 10)).multilineTextAlignment(.center)
                    }
                    .foregroundStyle(colors.muted)
                    .frame(width: 56, height: 56)
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(colors.border))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(n != 0 ? "Screenshot \(n), on your computer" : "Screenshot on your computer")
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

extension PickedPhoto {
    /// A photo coming back out of the queue, as the computer held it.
    init?(restoring image: PastedImage) {
        guard let comma = image.dataUrl.firstIndex(of: ","),
            let data = Data(base64Encoded: String(image.dataUrl[image.dataUrl.index(after: comma)...])),
            let full = UIImage(data: data)
        else { return nil }
        self.init(image: image, thumbnail: scale(full, longSide: 168))
    }
}
