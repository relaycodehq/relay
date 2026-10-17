import RelayMarkdown
import SwiftUI
import UIKit

/// How a run of selectable text is set: SwiftUI's text styles, as UIKit fonts.
struct TextLook: Equatable {
    var style: UIFont.TextStyle = .body
    var weight: UIFont.Weight?
    var secondary = false
    /// A colour of its own instead of the label colours.
    var color: Color?
}

/// Text that selects in place, as Notes does: hold a word to select it, drag the handles,
/// then Copy, Look Up or Share. A UITextView, since SwiftUI's Text only copies whole on iOS
/// and its selection kept catching taps where the text was before the thread moved it.
struct SelectableText: View {
    let text: AttributedString
    var look = TextLook()
    @Environment(\.colors) private var colors
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.openURL) private var openURL

    var body: some View {
        // The type size is read so a change sets the fonts again.
        let _ = typeSize
        TextViewRepresentable(text: uiText(), link: UIColor(colors.accent), openURL: openURL)
    }

    private func uiText() -> NSAttributedString {
        // At the app's type size, which runs smaller than the phone's: UIKit reads the phone's.
        var base = UIFont.preferredFont(
            forTextStyle: look.style,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(typeSize)))
        if let weight = look.weight {
            base = UIFont.systemFont(ofSize: base.pointSize, weight: weight)
        }
        let color = look.color.map { UIColor($0) } ?? (look.secondary ? .secondaryLabel : .label)
        let out = NSMutableAttributedString()
        for run in text.runs {
            let intent = run.inlinePresentationIntent ?? []
            var font = base
            var traits = base.fontDescriptor.symbolicTraits
            if intent.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
            if intent.contains(.emphasized) { traits.insert(.traitItalic) }
            if intent.contains(.code) || run.inlineMath == .source {
                font = .monospacedSystemFont(ofSize: base.pointSize, weight: traits.contains(.traitBold) ? .semibold : .regular)
            } else if run.inlineMath == .plain,
                let descriptor = base.fontDescriptor.withDesign(.serif)?.withSymbolicTraits(traits)
            {
                // A formula as plain text, in a serif italic as Android sets it.
                font = UIFont(descriptor: descriptor, size: 0)
            } else if traits != base.fontDescriptor.symbolicTraits,
                let descriptor = base.fontDescriptor.withSymbolicTraits(traits)
            {
                font = UIFont(descriptor: descriptor, size: 0)
            }
            // A formula plain text can't hold shows as its TeX, muted and without code's background.
            let runColor = run.inlineMath == .source ? UIColor.secondaryLabel : color
            var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: runColor]
            if intent.contains(.code) { attributes[.backgroundColor] = UIColor.secondaryLabel.withAlphaComponent(0.18) }
            if intent.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let link = run.link { attributes[.link] = link }
            out.append(NSAttributedString(string: String(text[run.range].characters), attributes: attributes))
        }
        return out
    }
}

/// The one selection in the app at a time: a new one clears the last, and a tap on the
/// thread clears it.
@MainActor
enum TextSelection {
    private static weak var current: UITextView?

    static func began(in view: UITextView) {
        if let current, current !== view { current.selectedTextRange = nil }
        current = view
    }

    static func clear() {
        current?.selectedTextRange = nil
        current = nil
    }
}

private struct TextViewRepresentable: UIViewRepresentable {
    let text: NSAttributedString
    let link: UIColor
    let openURL: OpenURLAction

    func makeUIView(context: Context) -> UITextView {
        // TextKit 1, so the size measured below is the size it lays out at.
        let view = UITextView(usingTextLayoutManager: false)
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.dataDetectorTypes = []
        view.delegate = context.coordinator
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.attributedText != text { view.attributedText = text }
        view.linkTextAttributes = [.foregroundColor: link]
        context.coordinator.openURL = openURL
    }

    /// As wide as the text needs up to what's offered, as tall as it wraps to.
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? .greatestFiniteMagnitude
        let fits = text.boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        // A point to spare, so a measured width never wraps its last word.
        return CGSize(width: min(width, ceil(fits.width) + 1), height: ceil(fits.height))
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UITextViewDelegate {
        var openURL: OpenURLAction?

        func textViewDidChangeSelection(_ view: UITextView) {
            if view.selectedRange.length > 0 { TextSelection.began(in: view) }
        }

        /// A tapped link goes where SwiftUI's links go, so the computer's localhost opens in Relay's browser.
        func textView(_ view: UITextView, primaryActionFor item: UITextItem, defaultAction: UIAction) -> UIAction? {
            guard case .link(let url) = item.content, let openURL else { return defaultAction }
            return UIAction { _ in openURL(url) }
        }
    }
}
