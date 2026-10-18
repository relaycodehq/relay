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
    @Environment(\.openPath) private var openPath

    var body: some View {
        // The type size is read so a change sets the fonts again.
        let _ = typeSize
        TextViewRepresentable(text: uiText(), link: UIColor(colors.accent), openURL: openURL, openPath: openPath)
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
                // A size under the words around it, as Android sets code (13.5 in 15).
                font = .mono(size: base.pointSize * 0.9, medium: traits.contains(.traitBold))
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
            if intent.contains(.code) { attributes[.backgroundColor] = UIColor(colors.code) }
            if intent.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            let string = String(text[run.range].characters)
            if let link = run.link {
                attributes[.link] = link
            } else if intent.contains(.code), openPath?(string.trimmingCharacters(in: .whitespaces), true) != nil {
                // A path or a tunnelled address in backticks opens like a link.
                attributes[.link] = PathLink.url(string.trimmingCharacters(in: .whitespaces))
            }
            out.append(NSAttributedString(string: string, attributes: attributes))
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
    let openPath: OpenPath?

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
        context.coordinator.openPath = openPath
    }

    /// As wide as the text needs up to what's offered, as tall as it wraps to.
    /// Kept per width until the text changes: the thread's layout asks again on every pass, and
    /// measuring every paragraph each time was much of opening a long thread.
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? .greatestFiniteMagnitude
        let coordinator = context.coordinator
        if coordinator.measured !== text, coordinator.measured?.isEqual(to: text) != true {
            coordinator.measured = text
            coordinator.sizes = [:]
        }
        if let known = coordinator.sizes[width] { return known }
        let fits = text.boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        // A point to spare, so a measured width never wraps its last word.
        let size = CGSize(width: min(width, ceil(fits.width) + 1), height: ceil(fits.height))
        coordinator.sizes[width] = size
        return size
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UITextViewDelegate {
        var openURL: OpenURLAction?
        var openPath: OpenPath?
        var measured: NSAttributedString?
        var sizes: [CGFloat: CGSize] = [:]

        func textViewDidChangeSelection(_ view: UITextView) {
            if view.selectedRange.length > 0 { TextSelection.began(in: view) }
        }

        /// A tapped link goes where SwiftUI's links go, so the computer's localhost opens in Relay's browser;
        /// one naming a file in the thread's folder opens it here.
        func textView(_ view: UITextView, primaryActionFor item: UITextItem, defaultAction: UIAction) -> UIAction? {
            guard case .link(let url) = item.content else { return defaultAction }
            if let code = PathLink.code(in: url) {
                return openPath?(code, true).map { open in UIAction { _ in open() } }
            }
            if let open = openPath?(url.absoluteString, false) { return UIAction { _ in open() } }
            guard let openURL else { return defaultAction }
            return UIAction { _ in openURL(url) }
        }
    }
}
