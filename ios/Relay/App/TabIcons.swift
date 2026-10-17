import SwiftUI
import UIKit

/// The tabs' icons, a part of the picked tab's in the accent: Threads' front bubble, Projects'
/// first square, Settings' teeth. The bar draws a symbol in one colour, so the picked one is a
/// drawn image that keeps its own.
enum TabIcon {
    case threads, projects, settings

    private var symbol: String {
        switch self {
        case .threads: "bubble.left.and.bubble.right.fill"
        case .projects: "square.grid.2x2.fill"
        case .settings: "gearshape.fill"
        }
    }

    @MainActor
    func image(picked: Bool, accent: Color, ink: Color) -> Image {
        // The bar fills an outline symbol itself, as it did before.
        guard picked else { return Image(systemName: symbol.replacingOccurrences(of: ".fill", with: "")) }
        return Image(uiImage: Self.drawn(self, accent: UIColor(accent), ink: UIColor(ink)))
    }

    @MainActor private static var cache: [String: UIImage] = [:]

    @MainActor
    private static func drawn(_ icon: TabIcon, accent: UIColor, ink: UIColor) -> UIImage {
        let key = "\(icon):\(accent.description):\(ink.description)"
        if let known = cache[key] { return known }
        let config = UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold, scale: .large)
        guard let base = UIImage(systemName: icon.symbol, withConfiguration: config) else { return UIImage() }
        let bounds = CGRect(origin: .zero, size: base.size)
        // Drawn into an image of its own: the bar would take a symbol's palette as one colour.
        let made = UIGraphicsImageRenderer(size: base.size).image { context in
            if icon == .threads {
                // The front bubble is a layer of its own.
                base.applyingSymbolConfiguration(.init(paletteColors: [accent, ink]))?.draw(in: bounds)
            } else {
                base.withTintColor(ink, renderingMode: .alwaysOriginal).draw(in: bounds)
                context.cgContext.addPath(icon.accentPart(in: bounds).cgPath)
                context.cgContext.clip(using: .evenOdd)
                base.withTintColor(accent, renderingMode: .alwaysOriginal).draw(in: bounds)
            }
        }
        .withRenderingMode(.alwaysOriginal)
        // Drawn at the symbol's size, it sits on the baseline the bar gives symbols.
        let placed = made.withBaselineOffset(fromBottom: base.baselineOffsetFromBottom ?? 0)
        cache[key] = placed
        return placed
    }

    /// Where the accent goes, as a region of the icon's box.
    private func accentPart(in box: CGRect) -> UIBezierPath {
        switch self {
        case .threads:
            return UIBezierPath(rect: box)
        case .projects:
            return UIBezierPath(rect: CGRect(x: box.minX, y: box.minY, width: box.width / 2, height: box.height / 2))
        case .settings:
            // A ring beyond the gear's body: only the teeth reach it.
            let centre = CGPoint(x: box.midX, y: box.midY)
            let path = UIBezierPath(ovalIn: box.insetBy(dx: -4, dy: -4))
            let body = min(box.width, box.height) * 0.3
            path.append(UIBezierPath(arcCenter: centre, radius: body, startAngle: 0, endAngle: .pi * 2, clockwise: true))
            return path
        }
    }
}
