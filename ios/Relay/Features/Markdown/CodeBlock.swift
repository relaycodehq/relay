import RelayMarkdown
import SwiftUI

/// A fenced block: its language and a copy button over the code, highlighted, numbered when it
/// runs a few lines, and scrolling sideways rather than wrap. Long ones fold, as on Android.
struct CodeBlock: View {
    let language: String?
    let code: String
    @State private var unfolded = false
    @State private var copied = false
    @Environment(\.colors) private var colors

    private static let foldOver = 18
    private static let foldTo = 15
    /// Blocks shorter than this read better without line numbers.
    private static let numberedFrom = 5

    var body: some View {
        let lines = Highlighted.lines(code, language: language.flatMap(languageFor))
        let folds = lines.count > Self.foldOver && !unfolded
        let shown = folds ? Array(lines.prefix(Self.foldTo)) : lines
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "text")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = code
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        copied = false
                    }
                }
                .labelStyle(.iconOnly)
                .font(.caption)
                .foregroundStyle(.secondary)
                .sensoryFeedback(.success, trigger: copied) { _, now in now }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 4)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 10) {
                    if lines.count >= Self.numberedFrom {
                        Text((1...shown.count).map(String.init).joined(separator: "\n"))
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(colors.faint)
                    }
                    Text(joined(shown))
                }
                .font(.system(.footnote, design: .monospaced))
                .padding(.horizontal, 12)
                .padding(.bottom, folds ? 4 : 10)
            }
            .scrollIndicators(.hidden)
            if folds {
                Button("Show all \(lines.count) lines") { unfolded = true }
                    .font(.caption)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.codeBackground, in: .rect(cornerRadius: 12))
    }

    private func joined(_ lines: [[CodeToken]]) -> AttributedString {
        var out = AttributedString()
        for (i, line) in lines.enumerated() {
            if i > 0 { out += AttributedString("\n") }
            out += styledLine(line, dark: colors.dark)
        }
        return out
    }
}
