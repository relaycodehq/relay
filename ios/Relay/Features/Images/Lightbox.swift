import RelayRemote
import SwiftUI
import UIKit

/// What the lightbox shows: a fixed list, and the one opened.
struct Viewing: Identifiable {
    let images: [MessageImage]
    let index: Int
    var id: ImageSource { images[index].source }
}

/// A message's pictures over the whole screen, as Photos shows them: swipe between them,
/// pinch or double-tap to zoom, drag down to put it away.
struct Lightbox: View {
    let images: [MessageImage]
    /// Where it zooms back into the picture showing.
    let space: Namespace.ID
    @State private var index: Int
    @State private var chrome = true
    @Environment(\.dismiss) private var dismiss

    init(_ viewing: Viewing, space: Namespace.ID) {
        images = viewing.images
        self.space = space
        _index = State(initialValue: viewing.index)
    }

    var body: some View {
        TabView(selection: $index) {
            ForEach(Array(images.enumerated()), id: \.offset) { i, image in
                Page(image: image, active: i == index) { withAnimation(.easeOut(duration: 0.2)) { chrome.toggle() } }
                    .tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: images.count > 1 && chrome ? .automatic : .never))
        .background(.black)
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            if chrome { bar.transition(.opacity) }
        }
        .statusBarHidden(!chrome)
        .preferredColorScheme(.dark)
        .navigationTransition(.zoom(sourceID: images[min(index, images.count - 1)].source, in: space))
    }

    private var bar: some View {
        let image = images[min(index, images.count - 1)]
        return HStack(spacing: 12) {
            Button("Close", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
            VStack(alignment: .leading, spacing: 1) {
                Text(image.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                if images.count > 1 {
                    Text("\(index + 1) of \(images.count)").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ShareImage(source: image.source, name: image.name)
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }
}

/// Shares the picture as it is once it has loaded.
private struct ShareImage: View {
    let source: ImageSource
    let name: String

    var body: some View {
        RemoteImage(source: source) { loaded in
            if let picture = loaded.image {
                let image = Image(uiImage: picture)
                ShareLink(item: image, preview: SharePreview(name, image: image)) {
                    Image(systemName: "square.and.arrow.up")
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
            }
        }
    }
}

private struct Page: View {
    let image: MessageImage
    let active: Bool
    let onTap: () -> Void

    var body: some View {
        RemoteImage(source: image.source) { loaded in
            if let picture = loaded.image {
                ZoomingImage(image: picture, active: active, onTap: onTap)
                    .accessibilityLabel(image.name)
            } else if loaded.failed {
                Text("This image couldn’t be loaded.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A picture fitted to the screen that pinches and double-taps into a zoom and pans
/// around once zoomed. Swiped away to another, it zooms back out.
private struct ZoomingImage: UIViewRepresentable {
    let image: UIImage
    let active: Bool
    let onTap: () -> Void

    func makeUIView(context: Context) -> ZoomView { ZoomView(image: image) }

    func updateUIView(_ view: ZoomView, context: Context) {
        view.onTap = onTap
        if view.imageView.image !== image {
            view.imageView.image = image
            view.setNeedsLayout()
        }
        if !active, view.zoomScale != 1 { view.setZoomScale(1, animated: false) }
    }
}

final class ZoomView: UIScrollView, UIScrollViewDelegate {
    let imageView: UIImageView
    var onTap: () -> Void = {}
    private var laidOut: CGSize = .zero

    init(image: UIImage) {
        imageView = UIImageView(image: image)
        super.init(frame: .zero)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 5
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        imageView.contentMode = .scaleAspectFit
        addSubview(imageView)
        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped))
        double.numberOfTapsRequired = 2
        addGestureRecognizer(double)
        let single = UITapGestureRecognizer(target: self, action: #selector(tapped))
        single.require(toFail: double)
        addGestureRecognizer(single)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != laidOut, let size = imageView.image?.size, size.width > 0, size.height > 0 else { return }
        laidOut = bounds.size
        zoomScale = 1
        let fit = min(bounds.width / size.width, bounds.height / size.height)
        imageView.frame = CGRect(origin: .zero, size: CGSize(width: size.width * fit, height: size.height * fit))
        contentSize = imageView.frame.size
        centre()
    }

    /// Smaller than the screen on a side, the picture sits in its middle.
    private func centre() {
        let x = max((bounds.width - contentSize.width) / 2, 0)
        let y = max((bounds.height - contentSize.height) / 2, 0)
        contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { centre() }

    @objc private func tapped() { onTap() }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        if zoomScale > 1 {
            setZoomScale(1, animated: true)
            return
        }
        let point = gesture.location(in: imageView)
        let scale: CGFloat = 2.5
        let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
        zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
    }
}
