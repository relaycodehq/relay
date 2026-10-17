import SwiftUI

/// An agent's mark, the desktop's own (Resources/Marks): Claude keeps its
/// orange, the rest take the foreground style.
struct ProviderMark: View {
    let provider: String
    var size: CGFloat = 14

    private var asset: String {
        if provider.hasPrefix("acp:") { return "acp" }
        switch provider {
        case "claude", "cursor", "muse", "amp", "antigravity", "opencode": return provider
        default: return "codex"
        }
    }

    var body: some View {
        Image("Marks/\(asset)")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
