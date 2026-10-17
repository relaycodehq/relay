import RelayRemote
import SwiftUI

/// Opens a picture full screen among others; the thread sets it, zooming out of `space`.
struct OpenImage {
    let space: Namespace.ID
    let open: (_ source: ImageSource, _ among: [MessageImage]) -> Void

    func callAsFunction(_ source: ImageSource, among: [MessageImage]) { open(source, among) }
}

extension EnvironmentValues {
    @Entry var openImage: OpenImage?
}

private let thumb: CGFloat = 88
private let answerHeight: CGFloat = 420
private let traceHeight: CGFloat = 88

/// A message's picture row: pasted ones, and those its agent read but didn't show.
/// Scrolls sideways only once it's wider than the thread.
struct MessageImageRow: View {
    let images: [MessageImage]
    /// What the lightbox steps through from here.
    let among: [MessageImage]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row
            ScrollView(.horizontal) { row }.scrollIndicators(.hidden).scrollClipDisabled()
        }
    }

    private var row: some View {
        HStack(spacing: 8) {
            ForEach(images, id: \.source) { Thumb(image: $0, among: among) }
        }
    }
}

private struct Thumb: View {
    let image: MessageImage
    let among: [MessageImage]
    @Environment(\.openImage) private var openImage
    @Environment(\.displayScale) private var scale
    @Environment(\.colors) private var colors

    var body: some View {
        // Covers a square, so its shorter side is what has to fill it.
        RemoteImage(source: image.source, max: Int(thumb * 2 * scale)) { loaded in
            Button { openImage?(image.source, among: among) } label: {
                ZStack {
                    colors.fill
                    if let picture = loaded.image {
                        Image(uiImage: picture).resizable().scaledToFill()
                    } else if loaded.failed {
                        Image(systemName: "photo").foregroundStyle(colors.faint)
                    } else {
                        Spinner(size: 16)
                    }
                }
                .frame(width: thumb, height: thumb)
                .clipShape(.rect(cornerRadius: 10))
                .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(colors.border, lineWidth: 0.5) }
                .contentShape(.rect(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .disabled(loaded.image == nil)
            .accessibilityLabel(image.name)
            .zoomSource(image.source)
        }
    }
}

/// A picture an answer embeds, full width where the text puts it; nothing until it
/// loads, so it takes its height once, or if it can't.
struct AnswerImage: View {
    let source: ImageSource
    let alt: String
    let among: [MessageImage]
    @Environment(\.openImage) private var openImage
    @Environment(\.displayScale) private var scale
    @Environment(\.colors) private var colors

    var body: some View {
        RemoteImage(source: source, max: Int(max(answerHeight, 430) * scale)) { loaded in
            if let picture = loaded.image, picture.size.width > 0, picture.size.height > 0 {
                let ratio = picture.size.width / picture.size.height
                Button { openImage?(source, among: among) } label: {
                    Image(uiImage: picture)
                        .resizable()
                        .aspectRatio(ratio, contentMode: .fit)
                        .clipShape(.rect(cornerRadius: 10))
                        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(colors.border, lineWidth: 0.5) }
                }
                .buttonStyle(.plain)
                // A tall screenshot narrows instead of running screens long.
                .frame(maxWidth: answerHeight * ratio, alignment: .leading)
                .accessibilityLabel(alt.isEmpty ? "Image" : alt)
                .zoomSource(source)
            }
        }
    }
}

/// The picture a trace row's call looked at, under the row and big enough to tell what it
/// is. Its height is held from the start, so the call, the fetch and the decode don't move
/// the trace.
struct ReadPreview: View {
    let source: ImageSource
    let name: String
    let done: Bool
    let among: [MessageImage]
    @Environment(\.openImage) private var openImage
    @Environment(\.displayScale) private var scale
    @Environment(\.colors) private var colors

    var body: some View {
        if done {
            RemoteImage(source: source, max: Int(traceHeight * 2 * scale)) { loaded in
                Button { openImage?(source, among: among) } label: { frame(loaded.image) }
                    .buttonStyle(.plain)
                    .disabled(loaded.image == nil)
                    .accessibilityLabel(name)
                    .zoomSource(source)
            }
        } else {
            frame(nil)
        }
    }

    private func frame(_ picture: UIImage?) -> some View {
        // Wider or taller than these, a picture is cropped rather than squeezed.
        let ratio = picture.map { min(max($0.size.width / max($0.size.height, 1), 0.75), 2) } ?? 4 / 3
        return ZStack {
            colors.fill
            if let picture { Image(uiImage: picture).resizable().scaledToFill() }
        }
        .frame(width: traceHeight * ratio, height: traceHeight)
        .clipShape(.rect(cornerRadius: 8))
        .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(colors.border, lineWidth: 0.5) }
        .padding(.vertical, 2)
    }
}

extension View {
    /// Where the lightbox zooms out of and back into.
    @ViewBuilder func zoomSource(_ source: ImageSource) -> some View {
        modifier(ZoomSource(source: source))
    }
}

private struct ZoomSource: ViewModifier {
    let source: ImageSource
    @Environment(\.openImage) private var openImage

    func body(content: Content) -> some View {
        if let space = openImage?.space {
            content.matchedTransitionSource(id: source, in: space)
        } else {
            content
        }
    }
}
