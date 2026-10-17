import RelayRemote
import SwiftUI

/// Long enough to read and reach, short enough not to linger.
private let shownFor: Duration = .seconds(10)

extension View {
    /// Another thread's news over the top of the screen, gone after a while (Android's NeedsYou,
    /// for finished and failed answers too). Hidden where the list says so already, and never
    /// about the thread on screen.
    func threadNotices(openId: String?, hidden: Bool, open: @escaping (String) -> Void) -> some View {
        modifier(NoticeHost(openId: openId, hidden: hidden, open: open))
    }
}

private struct NoticeHost: ViewModifier {
    let openId: String?
    let hidden: Bool
    let open: (String) -> Void
    @Environment(Connection.self) private var connection

    func body(content: Content) -> some View {
        let notices = connection.notices
        let notice = notices.queue.first
        content
            .overlay(alignment: .top) {
                if let notice, !hidden, notice.news.chatId != openId {
                    NoticeBanner(news: notice.news, project: project(notice.news.chatId)) {
                        notices.dismiss(notice.id)
                        open(notice.news.chatId)
                    } dismiss: {
                        notices.dismiss(notice.id)
                    }
                    .id(notice.id)
                    .padding(.horizontal, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: notice.id) {
                        try? await Task.sleep(for: shownFor)
                        if !Task.isCancelled { notices.dismiss(notice.id) }
                    }
                }
            }
            .animation(.snappy(duration: 0.3), value: hidden ? nil : notice?.id)
            .onChange(of: openId, initial: true) { _, id in
                if let id { notices.opened(id) }
            }
    }

    private func project(_ chatId: String) -> String? {
        connection.chats.first { $0.id == chatId }.flatMap { connection.project($0.projectId)?.name }
    }
}

private struct NoticeBanner: View {
    let news: ThreadNews
    let project: String?
    let open: () -> Void
    let dismiss: () -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 12) {
            mark.frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(news.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(colors.foreground)
                    .lineLimit(1)
                Text(project.map { "\(news.body) · \($0)" } ?? news.body)
                    .font(.footnote)
                    .foregroundStyle(news.kind == .waiting ? colors.waiting : colors.muted)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Dismiss", systemImage: "xmark", action: dismiss)
                .labelStyle(.iconOnly)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(colors.muted)
                .frame(width: 32, height: 32)
                .contentShape(.rect)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 10)
        .contentShape(.rect(cornerRadius: 22))
        .onTapGesture(perform: open)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(news.title). \(news.body)")
        .accessibilityHint("Opens the thread")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Dismiss", dismiss)
    }

    @ViewBuilder private var mark: some View {
        switch news.kind {
        case .waiting: Circle().fill(colors.waiting).frame(width: 9, height: 9)
        case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(colors.destructive)
        case .finished: Image(systemName: "checkmark.circle.fill").foregroundStyle(colors.accent)
        }
    }
}
