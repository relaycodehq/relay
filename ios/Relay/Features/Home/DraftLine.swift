import RelayRemote
import SwiftUI

/// A draft's text for where a row shows its branch, marked with where it was started.
func draftText(_ draft: ListedDraft) -> Text {
    let icon =
        switch draft.from {
        case .here: "pencil"
        case .computer: "laptopcomputer"
        case .phone: "iphone"
        }
    let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " ")
    let shown = text.isEmpty ? extrasSummary(draft.extras) : text
    return Text("\(Image(systemName: icon)) \(shown)")
}

extension Connection {
    /// The draft a thread's row shows, if there's one.
    func draft(of chatId: String) -> ListedDraft? {
        threadDraft(drafts.listed(active), chatId: chatId)
    }
}

extension View {
    /// A row holding a draft is tinted: it waits on you, as the desktop's cards do.
    func draftTint(_ on: Bool = true) -> some View {
        modifier(DraftTint(on: on))
    }
}

private struct DraftTint: ViewModifier {
    let on: Bool
    @Environment(\.colors) private var colors

    func body(content: Content) -> some View {
        content.background {
            if on {
                RoundedRectangle(cornerRadius: 12).fill(colors.waiting.opacity(0.1)).padding(.horizontal, -10)
            }
        }
    }
}
