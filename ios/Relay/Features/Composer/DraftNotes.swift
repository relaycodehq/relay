import RelayRemote
import SwiftUI

/// Over the composer's text: what the computer adds to this draft when it goes, and, edited
/// here and there at once, the other version a tap away.
struct DraftNotes: View {
    let computer: String
    let key: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        let shared = connection.drafts.shared(computer, key)
        // Its screenshots show as tiles in the box.
        let adds = extrasSummary(shared?.extras.map { var rest = $0; rest.screenshots = nil; return rest })
        if !adds.isEmpty || shared?.other != nil {
            VStack(alignment: .leading, spacing: 4) {
                if !adds.isEmpty {
                    Text("Your computer adds \(adds) when this goes.")
                }
                if let shared, let other = shared.other {
                    clash(shared, other)
                }
                if let error {
                    Text(error).foregroundStyle(colors.destructive)
                }
            }
            .font(.footnote)
            .foregroundStyle(colors.muted)
            .padding(.horizontal, 4)
            .padding(.top, 4)
        }
    }

    /// Whose the kept version is, and who else wrote at once: this phone, the computer, another phone.
    private func clash(_ shared: SharedDraft, _ other: DraftOther) -> some View {
        let mine = connection.drafts.isThisPhone(computer, other.by)
        let them = mine ? shared.by : other.by
        let use = mine ? "Use mine" : other.by == "desktop" ? "Use the computer's" : "Use the other phone's"
        return HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.branch")
            Text("Edited here and on \(them == "desktop" ? "your computer" : "another phone") at once")
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(use) { resolve(drop: false) }
                .fontWeight(.semibold)
                .foregroundStyle(colors.accent)
            Button("Keep this version", systemImage: "xmark") { resolve(drop: true) }
                .labelStyle(.iconOnly)
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    private func resolve(drop: Bool) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await connection.drafts.resolveOther(computer, key, drop: drop)
            } catch {
                self.error = "Couldn't switch the draft: \(error.localizedDescription)"
            }
        }
    }
}
