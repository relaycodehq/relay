import RelayRemote
import SwiftUI

/// Messages waiting their turn, and those sent with Send later, above the
/// composer as on Android: send one now (steering it into a running answer),
/// take it back to edit with ×, or hold it to move or delete it.
struct QueueList: View {
    let chatId: String
    let thread: RemoteChat
    let running: Bool
    /// Into the composer, out of the queue.
    let takeBack: (RemoteQueued) async throws -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var busy: Set<String> = []
    @State private var failure: String?

    var body: some View {
        let queue = thread.queue ?? []
        let later = thread.scheduled ?? []
        if !queue.isEmpty || !later.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(queue.enumerated()), id: \.element.id) { index, item in
                    row(item, index: index, of: queue.count, later: false)
                }
                ForEach(later) { item in
                    row(item, index: 0, of: later.count, later: true)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .animation(.snappy(duration: 0.2), value: queue.map(\.id) + later.map(\.id))
            .alert(
                "Couldn't change the queue", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
            ) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
        }
    }

    private var compacting: Bool { thread.messages.contains { $0.compaction == true && $0.streaming } }

    private func row(_ item: RemoteQueued, index: Int, of count: Int, later: Bool) -> some View {
        let working = busy.contains(item.id)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(withoutAgentMention(item.body))
                    .font(.subheadline)
                    .foregroundStyle(colors.foreground)
                    .lineLimit(2)
                TimelineView(.everyMinute) { context in
                    Text(
                        queuedStatus(
                            item, index: index, later: later, paused: thread.queuePaused == true,
                            compacting: compacting, now: Int64(context.date.timeIntervalSince1970 * 1000)))
                }
                .font(.caption)
                .foregroundStyle(item.error == nil ? colors.muted : colors.destructive)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                act(item) { try await connection.queue(chatId, .steer, messageId: item.id) }
            } label: {
                Text(compacting ? "Send next" : running ? "Steer now" : "Send now")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(colors.foreground)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(colors.border) }
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            // A reply goes back into its side conversation's composer.
            Button {
                act(item) { try await takeBack(item) }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(colors.muted)
                    .frame(width: 28, height: 28)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel and return to the composer")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 8)
        .background(colors.background, in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(colors.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        }
        .opacity(working ? 0.5 : 1)
        .disabled(working)
        .contextMenu {
            if !later {
                if index > 0 {
                    Button("Move Up", systemImage: "arrow.up") {
                        act(item) { try await connection.queue(chatId, .move(to: index - 1), messageId: item.id) }
                    }
                }
                if index < count - 1 {
                    Button("Move Down", systemImage: "arrow.down") {
                        act(item) { try await connection.queue(chatId, .move(to: index + 1), messageId: item.id) }
                    }
                }
            }
            Button("Edit", systemImage: "pencil") { act(item) { try await takeBack(item) } }
            Button("Delete", systemImage: "trash", role: .destructive) {
                act(item) { try await connection.queue(chatId, .remove, messageId: item.id) }
            }
        }
    }

    private func act(_ item: RemoteQueued, _ work: @escaping () async throws -> Void) {
        guard !busy.contains(item.id) else { return }
        busy.insert(item.id)
        Task {
            defer { busy.remove(item.id) }
            do { try await work() } catch { failure = error.localizedDescription }
        }
    }
}
