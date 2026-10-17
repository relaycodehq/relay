import RelayRemote
import SwiftUI

/// The desktop composer's slash menu (Android's CommandList.kt): Relay's own actions,
/// then the agent's commands or skills, over the composer while a `/` or `$` is typed.
struct CommandMenu: View {
    let items: [CommandMenuItem]
    let loading: Bool
    let failed: Bool
    let pick: (CommandMenuItem) -> Void
    @Environment(\.colors) private var colors
    @State private var height: CGFloat = 0

    var body: some View {
        // Only as tall as its rows, and scrolling once they pass the cap.
        ScrollView {
            rows.onGeometryChange(for: CGFloat.self, of: \.size.height) { height = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(height, 280))
        .glassEffect(.regular.tint(colors.background.opacity(0.8)), in: .rect(cornerRadius: 20))
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items) { item in
                Button { pick(item) } label: { row(item) }
                    .buttonStyle(.plain)
            }
            if items.isEmpty { note("No matching commands.") }
            if loading { note("Loading the agent's commands…") }
            if failed { note("The agent's commands are unavailable. Relay's actions still work.") }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ item: CommandMenuItem) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.label)
                    .font(.subheadline.monospaced())
                    .foregroundStyle(colors.foreground)
                if !item.description.isEmpty {
                    Text(item.description).font(.caption).foregroundStyle(colors.muted)
                }
            }
            .lineLimit(1)
            Spacer(minLength: 0)
            Text(item.source).font(.caption).foregroundStyle(colors.faint)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .contentShape(.rect)
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(colors.muted)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
    }
}
