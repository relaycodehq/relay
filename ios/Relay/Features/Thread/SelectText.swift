import SwiftUI
import UIKit

extension View {
    /// Holding it selects `text`: a sheet where any part of it selects and
    /// nothing moves under the handles. In place, SwiftUI's selectable Text
    /// leaves stale hit areas once the thread's layout shifts.
    func selectsOnHold(_ text: String, mono: Bool = false) -> some View {
        modifier(SelectOnHold(text: text, mono: mono))
    }
}

private struct SelectOnHold: ViewModifier {
    let text: String
    let mono: Bool
    @State private var selecting = false

    func body(content: Content) -> some View {
        content
            .onLongPressGesture(minimumDuration: 0.35) { selecting = true }
            .sensoryFeedback(.selection, trigger: selecting) { _, now in now }
            .accessibilityAction(named: "Select Text") { selecting = true }
            .selectTextSheet(isPresented: $selecting, text, mono: mono)
    }
}

extension View {
    /// A sheet where any part of `text` selects, with nothing moving under it.
    func selectTextSheet(isPresented: Binding<Bool>, _ text: String, mono: Bool = false) -> some View {
        sheet(isPresented: isPresented) {
            SelectSheet(text: text, mono: mono)
        }
    }
}

private struct SelectSheet: View {
    let text: String
    let mono: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var picked: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            SheetText(text: text, mono: mono, picked: $picked)
                .relayBackground()
                .navigationTitle("Select Text")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        // The selection, or all of it while nothing is.
                        Button(copied ? "Copied" : picked == nil ? "Copy All" : "Copy") {
                            UIPasteboard.general.string = picked ?? text
                            copied = true
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", systemImage: "checkmark") { dismiss() }
                    }
                }
                .onChange(of: picked) { copied = false }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Read-only text that selects any part of itself, which SwiftUI's Text
/// can't.
private struct SheetText: UIViewRepresentable {
    let text: String
    let mono: Bool
    @Binding var picked: String?

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.backgroundColor = .clear
        view.font =
            mono
            ? UIFontMetrics(forTextStyle: .footnote).scaledFont(
                for: .monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .footnote).pointSize, weight: .regular))
            : .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = .label
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }

    func makeCoordinator() -> Coordinator { Coordinator(picked: $picked) }

    final class Coordinator: NSObject, UITextViewDelegate {
        let picked: Binding<String?>
        init(picked: Binding<String?>) { self.picked = picked }

        func textViewDidChangeSelection(_ view: UITextView) {
            let range = view.selectedRange
            picked.wrappedValue = range.length > 0 ? (view.text as NSString).substring(with: range) : nil
        }
    }
}
