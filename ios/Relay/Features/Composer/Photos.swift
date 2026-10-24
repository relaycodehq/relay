import PhotosUI
import RelayRemote
import SwiftUI

/// A photo picked for the next message, with a small copy for the composer.
struct PickedPhoto: Identifiable, Sendable {
    let id = UUID()
    let image: PastedImage
    let thumbnail: UIImage
}

/// Photos picked but not sent, by the draft they go with, so they outlive its composer: an
/// approval card takes its place, or the thread is left and opened again. Gone when the app quits.
@MainActor
enum UnsentPhotos {
    private static var held: [String: [PickedPhoto]] = [:]

    static func take(_ draft: String) -> [PickedPhoto] { held[draft] ?? [] }

    static func keep(_ photos: [PickedPhoto], for draft: String) {
        held[draft] = photos.isEmpty ? nil : photos
    }

    /// A failed send returns to its original draft, even after its composer has left.
    @discardableResult
    static func restore(_ photos: [PickedPhoto], for draft: String) -> [PickedPhoto] {
        let current = take(draft)
        let ids = Set(current.map(\.id))
        let restored = current + photos.filter { !ids.contains($0.id) }
        keep(restored, for: draft)
        return restored
    }

    /// A new thread follows its chosen project, including photos already in either draft.
    static func move(_ computer: String, from: String, to: String) {
        guard from != to else { return }
        let source = "\(computer)\n\(from)", target = "\(computer)\n\(to)"
        let existing = take(target)
        let ids = Set(existing.map(\.id))
        keep(existing + take(source).filter { !ids.contains($0.id) }, for: target)
        held[source] = nil
    }
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
    var files: [AttachedFile] = []
    let loading: Int
    var computerShots: [Int] = []
    let remove: (PickedPhoto.ID) -> Void
    var retry: (AttachedFile) -> Void = { _ in }
    var removeFile: (AttachedFile) -> Void = { _ in }
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
                ForEach(files) { file in
                    FileCard(file: file, retry: { retry(file) }, remove: { removeFile(file) })
                }
                ForEach(0..<loading, id: \.self) { _ in
                    Spinner()
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
