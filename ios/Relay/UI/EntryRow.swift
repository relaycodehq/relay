import SwiftUI

/// A plain list row that opens something: an icon, a title with a line under it, a chevron.
struct EntryRow: View {
    let icon: String
    var tint: Color?
    let title: String
    var subtitle: String?
    var mono = false
    var chevron = true
    let action: () -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).foregroundStyle(tint ?? colors.muted).frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(mono ? .system(.body, design: .monospaced) : .body)
                        .foregroundStyle(colors.foreground)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.footnote).foregroundStyle(colors.muted).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                if chevron {
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(colors.faint)
                }
            }
            .padding(.vertical, subtitle?.isEmpty == false ? 9 : 11)
            .contentShape(.rect)
        }
        .activityRow()
    }
}
