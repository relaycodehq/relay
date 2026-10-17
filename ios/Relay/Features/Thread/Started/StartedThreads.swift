import RelayRemote
import SwiftUI

// The threads a lead's agent started (the desktop's StartedChip): listed in
// the turn that started them, and over the composer while any still works or asks.

/// How many of a turn's threads show before "N more".
private let firstShown = 4

/// Still, like a subagent's: a dot while it works, amber when it asks, a check once done.
struct StartedMark: View {
    let waiting: Bool
    let running: Bool
    @Environment(\.colors) private var colors

    var body: some View {
        Group {
            if waiting || running {
                Circle().fill(waiting ? colors.waiting : colors.accent).frame(width: 7, height: 7)
                    .accessibilityLabel(waiting ? "Needs you" : "Working")
            } else {
                Image(systemName: "checkmark").font(.caption.weight(.semibold)).foregroundStyle(colors.additionText)
                    .accessibilityLabel("Done")
            }
        }
        .frame(width: 18)
    }
}

/// The family's mark: amber if any asks, a dot if any works, else a check.
struct FamilyMark: View {
    let started: [RemoteChatSummary]

    var body: some View {
        StartedMark(waiting: started.contains { $0.waiting == true }, running: started.contains { $0.running == true })
    }
}

struct StartedRow: View {
    let chat: RemoteChatSummary
    let peek: StartedPeek
    let open: () -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        let now = startedNow(chat, answer: peek.answer, request: peek.request)
        Button(action: open) {
            HStack(spacing: 10) {
                StartedMark(waiting: chat.waiting == true, running: chat.running == true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(chat.title).font(.subheadline.weight(.semibold)).foregroundStyle(colors.foreground)
                    Text(now.text).font(.footnote).foregroundStyle(now.asks ? colors.waiting : colors.muted)
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(colors.faint)
            }
            .padding(.vertical, 5)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// Under a turn that called start_threads: the threads each call started, live.
struct StartedInTurn: View {
    let chatId: String
    let message: ChatMessage
    @Environment(Connection.self) private var connection

    var body: some View {
        let family = startedOf(chatId, connection.chats)
        let groups = startGroups(message, family)
        if !groups.isEmpty {
            let threads = groups.flatMap(\.threads)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(groups) { group in
                    StartGroupRows(count: group.count, threads: group.threads)
                }
            }
            .task(id: threads.map { "\($0.id):\($0.running == true):\($0.waiting == true):\($0.updated)" }) {
                StartedPeeks.shared.follow(threads, connection)
            }
        }
    }
}

private struct StartGroupRows: View {
    let count: Int
    let threads: [RemoteChatSummary]
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors
    @State private var all = false

    var body: some View {
        let shown = all || threads.count <= firstShown + 1 ? threads : Array(threads.prefix(firstShown))
        VStack(alignment: .leading, spacing: 4) {
            Label("Started \(plural(count, "thread"))", systemImage: "bubble.left.and.bubble.right")
                .font(.subheadline)
                .foregroundStyle(colors.muted)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(shown) { chat in
                    StartedRow(chat: chat, peek: StartedPeeks.shared.peek(connection.active, chat.id)) {
                        navigate(.thread(chat.id))
                    }
                }
                if shown.count < threads.count {
                    Button {
                        all = true
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "chevron.down").font(.caption.weight(.semibold)).frame(width: 18)
                            Text("\(threads.count - shown.count) more")
                        }
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .frame(minHeight: 36)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(colors.border).frame(width: 2) }
            .padding(.leading, 6)
        }
    }
}

/// The started threads in a sheet.
struct StartedList: View {
    let started: [RemoteChatSummary]
    let open: (String) -> Void
    @Environment(Connection.self) private var connection

    var body: some View {
        ForEach(started) { chat in
            StartedRow(chat: chat, peek: StartedPeeks.shared.peek(connection.active, chat.id)) { open(chat.id) }
        }
        .task(id: started.map { "\($0.id):\($0.running == true):\($0.waiting == true):\($0.updated)" }) {
            StartedPeeks.shared.follow(started, connection)
        }
    }
}
