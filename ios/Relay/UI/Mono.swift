import SwiftUI
import UIKit

/// JetBrains Mono, the face Android sets code in, for everything in monospace. Only Regular and
/// Medium ship (`Resources/Fonts`, listed under `UIAppFonts`), so bold code comes out Medium.
extension Font {
    /// Sized like `style` and following Dynamic Type with it.
    static func mono(_ style: Font.TextStyle, medium: Bool = false) -> Font {
        .custom(monoFace(medium), size: style.defaultSize, relativeTo: style)
    }

    static func mono(size: CGFloat, medium: Bool = false) -> Font {
        .custom(monoFace(medium), fixedSize: size)
    }
}

extension UIFont {
    static func mono(size: CGFloat, medium: Bool = false) -> UIFont {
        UIFont(name: monoFace(medium), size: size) ?? .monospacedSystemFont(ofSize: size, weight: medium ? .medium : .regular)
    }
}

private func monoFace(_ medium: Bool) -> String { medium ? "JetBrainsMono-Medium" : "JetBrainsMono-Regular" }

extension Font.TextStyle {
    /// The point size at the default text size, which `relativeTo:` scales from.
    fileprivate var defaultSize: CGFloat {
        let large = UITraitCollection(preferredContentSizeCategory: .large)
        return UIFont.preferredFont(forTextStyle: uiStyle, compatibleWith: large).pointSize
    }

    private var uiStyle: UIFont.TextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
}
