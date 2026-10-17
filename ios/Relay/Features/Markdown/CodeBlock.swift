import SwiftUI

/// A fenced block: its language and a copy button over the code, which
/// scrolls sideways rather than wrap. Long ones fold, as on Android.
struct CodeBlock: View {
    let language: String?
    let code: String
    @State private var unfolded = false
    @State private var copied = false

    private static let foldOver = 18
    private static let foldTo = 15

    private var lines: [Substring] { code.split(separator: "\n", omittingEmptySubsequences: false) }
    private var folds: Bool { lines.count > Self.foldOver && !unfolded }

    var body: some View {
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
                Text(folds ? lines.prefix(Self.foldTo).joined(separator: "\n") : code)
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
}
