import RelayRemote
import SwiftUI

/// Long enough to read and reach, short enough not to linger.
private let shownFor = Duration.seconds(10)

/// While you're inside one thread, another starting to wait on you drops in under the bar and
/// buzzes once, so it isn't missed with the list out of view (Android's NeedsYou.kt).
struct NeedsYou: View {
    /// The tab's screens: the thread on top needs no telling.
    let stack: StackPath
    /// The tab's root is the thread list, which already says so.
    let atList: Bool
    let open: (String) -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var before: WaitingBaseline?
    @State private var shown: String?

    private var openId: String? {
        switch stack.routes.last {
        case .thread(let id), .replies(let id, _): id
        default: nil
        }
    }

    var body: some View {
        let waiting = connection.listed.filter { $0.waiting == true }.map(\.id)
        let chat = connection.listed.first { $0.id == shown && $0.waiting == true }
        // Drawn always, so its watch runs while there's nothing to show.
        ZStack(alignment: .top) {
            Color.clear.frame(width: 0, height: 0)
            if let chat, chat.id != openId, !(atList && stack.routes.isEmpty) {
                banner(chat)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.3), value: chat?.id)
        .onChange(of: Watched(computer: connection.active, waiting: waiting, loaded: connection.overview != nil), initial: true) {
            _, now in
            guard now.loaded else { return }
            if let fresh = freshlyWaiting(before, computer: now.computer, waiting: now.waiting, openId: openId) {
                shown = fresh
            }
            before = WaitingBaseline(computer: now.computer, waiting: Set(now.waiting))
        }
        // The thread list says so itself: seen there, it's been told.
        .onChange(of: atList && stack.routes.isEmpty && shown != nil, initial: true) { _, told in
            if told { shown = nil }
        }
        .task(id: shown) {
            guard shown != nil else { return }
            try? await Task.sleep(for: shownFor)
            if !Task.isCancelled { shown = nil }
        }
        .sensoryFeedback(.warning, trigger: shown) { _, now in now != nil }
    }

    private func banner(_ chat: RemoteChatSummary) -> some View {
        let project = connection.project(chat.projectId)?.name
        return HStack(spacing: 12) {
            Button {
                shown = nil
                open(chat.id)
            } label: {
                HStack(spacing: 12) {
                    Circle().fill(colors.waiting).frame(width: 8, height: 8)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(chat.title)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(colors.foreground)
                        Text("Needs input\(project.map { " · \($0)" } ?? "")")
                            .font(.caption)
                            .foregroundStyle(colors.waiting)
                    }
                    .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(chat.title) needs you. Open it.")
            Button("Dismiss", systemImage: "xmark") { shown = nil }
                .labelStyle(.iconOnly)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(colors.muted)
                .frame(width: 28, height: 28)
                .contentShape(.rect)
                .buttonStyle(.plain)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 10)
        // Over a thread's text: glass alone lets the words behind read through.
        .background(colors.background.opacity(0.75), in: .rect(cornerRadius: 20))
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20))
        .padding(.horizontal, 12)
        // Under the bar, clear of the screen's own title and buttons.
        .padding(.top, 52)
        .accessibilityElement(children: .contain)
    }
}

private struct Watched: Equatable {
    let computer: String?
    let waiting: [String]
    let loaded: Bool
}
