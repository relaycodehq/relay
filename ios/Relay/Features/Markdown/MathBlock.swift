import RelayMarkdown
import RelayRemote
import SwiftUI

/// KaTeX from the app's bundle (Android's copy), read once off the main thread: about 600KB.
private let katexAssets = Task.detached(priority: .userInitiated) { () -> KatexAssets? in
    guard let folder = Bundle.main.url(forResource: "katex", withExtension: nil) else { return nil }
    return try? KatexAssets(directory: folder)
}

/// Each formula's page, kept: it carries KaTeX whole, too big to build again on every update
/// of an answer still writing, and the same string lets the web view see it's the same page.
@MainActor private var documents: [String: String] = [:]

/// A `$$` formula, typeset by KaTeX in a page of its own; its TeX until that has drawn,
/// and for good while the answer is still writing it.
struct MathBlock: View {
    let tex: String
    let closed: Bool
    @Environment(\.colors) private var colors
    @State private var katex: KatexAssets?
    @State private var height: Int?

    private var typeset: Bool { closed && !tex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        ZStack(alignment: .leading) {
            if !typeset || height == nil {
                Text(tex.trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(.mono(size: 12.5))
                    .foregroundStyle(colors.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if typeset, let katex {
                PageView(page: document(katex)) { if case .size(let h) = $0 { height = h } }
                    .frame(height: CGFloat(height ?? 44))
                    .opacity(height == nil ? 0 : 1)
            }
        }
        .task(id: typeset) {
            if typeset, katex == nil { katex = await katexAssets.value }
        }
    }

    private func document(_ katex: KatexAssets) -> String {
        let theme = renderTheme(colors)
        let key = "\(theme.dark):\(theme.vars["--text"] ?? ""):\(tex)"
        if let known = documents[key] { return known }
        let made = mathDocument(tex, theme: theme, katex: katex)
        documents[key] = made
        return made
    }
}
