import SwiftUI

/// A short note over the bottom of the screen with at most one action, gone after a few
/// seconds (Android's toasts): "Settled · Undo".
struct ToastItem: Identifiable {
    let id = UUID()
    var title: String
    var detail: String?
    var actionLabel: String?
    var action: (() -> Void)?
    var seconds: Double = 5
}

extension View {
    func toast(_ item: Binding<ToastItem?>) -> some View {
        overlay(alignment: .bottom) {
            if let toast = item.wrappedValue {
                ToastView(toast) { item.wrappedValue = nil }
                    .id(toast.id)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: toast.id) {
                        try? await Task.sleep(for: .seconds(toast.seconds))
                        if item.wrappedValue?.id == toast.id { item.wrappedValue = nil }
                    }
            }
        }
        .animation(.snappy(duration: 0.25), value: item.wrappedValue?.id)
    }
}

private struct ToastView: View {
    let toast: ToastItem
    let dismiss: () -> Void
    @Environment(\.colors) private var colors

    init(_ toast: ToastItem, dismiss: @escaping () -> Void) {
        self.toast = toast
        self.dismiss = dismiss
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title).font(.subheadline.weight(.semibold)).foregroundStyle(colors.foreground)
                if let detail = toast.detail {
                    Text(detail).font(.footnote).foregroundStyle(colors.muted).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let label = toast.actionLabel, let action = toast.action {
                Button(label) {
                    dismiss()
                    action()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(colors.accent)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        // Tinted: rows scrolling under plain glass show through its text.
        .glassEffect(.regular.tint(colors.background.opacity(0.8)), in: .rect(cornerRadius: 18))
        .accessibilityElement(children: .contain)
    }
}
