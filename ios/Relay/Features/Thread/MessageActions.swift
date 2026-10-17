import RelayRemote
import SwiftUI
import UIKit

/// The desktop's MessageActions under an answer: when it ended, how fast it
/// wrote and what it cost, then copy, read aloud, fork and the rest.
struct MessageActions: View {
    let chatId: String
    let message: ChatMessage
    /// Offers a side conversation from it: only on the main one.
    var replies = true
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors
    @State private var copied = false
    @State private var forking = false
    @State private var selecting = false
    @State private var failure: String?

    /// Only a finished answer on the main conversation forks.
    private var forks: Bool { message.status == "complete" && message.parentId == nil && message.side != true }

    var body: some View {
        // The speed and cost go first when the row runs out of room.
        ViewThatFits(in: .horizontal) {
            row(stats: answerStats(message))
            row(stats: nil)
        }
        .font(.caption)
        .foregroundStyle(colors.faint)
        .padding(.top, 2)
        .selectTextSheet(isPresented: $selecting, message.body)
        .alert("Couldn't fork it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
        } message: {
            Text(failure ?? "")
        }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }

    private func row(stats: String?) -> some View {
        HStack(spacing: 18) {
            TimelineView(.everyMinute) { context in
                Text(Clock().sentLabel(message.ended ?? message.created, now: Int64(context.date.timeIntervalSince1970 * 1000)))
            }
            .fixedSize()
            if let stats { Text(stats).fixedSize() }
            HStack(spacing: 4) {
                icon(copied ? "checkmark" : "doc.on.doc", copied ? "Copied" : "Copy answer") {
                    UIPasteboard.general.string = message.body
                    copied = true
                }
                if message.status == "complete", !message.body.isEmpty {
                    ReadAloudButton(messageId: message.id, markdown: message.body)
                        .frame(width: 34, height: 32)
                        .contentShape(.rect)
                }
                if replies {
                    icon("arrowshape.turn.up.left", "Reply") { reply() }
                }
                if forks {
                    icon("arrow.triangle.branch", "Fork into a new thread") { fork() }
                        .disabled(forking)
                }
                more
            }
            .font(.system(size: 15))
            .foregroundStyle(colors.muted)
            .buttonStyle(.plain)
        }
    }

    private func icon(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 34, height: 32)
                .contentShape(.rect)
        }
        .accessibilityLabel(label)
    }

    private var more: some View {
        Menu {
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.body }
            Button("Select Text", systemImage: "selection.pin.in.out") { selecting = true }
            if replies {
                Button { reply() } label: {
                    Label("Reply", systemImage: "arrowshape.turn.up.left")
                    Text("A side conversation that leaves this one as it is.")
                }
            }
            if forks {
                Button("Fork from here", systemImage: "arrow.triangle.branch") { fork() }
            }
            if !message.body.isEmpty {
                ShareLink(item: message.body)
            }
        } label: {
            Image(systemName: "ellipsis")
                .frame(width: 34, height: 32)
                .contentShape(.rect)
        }
        .accessibilityLabel("More for this answer")
    }

    private func reply() { navigate(.replies(chatId: chatId, rootId: message.id)) }

    private func fork() {
        forking = true
        Task {
            defer { forking = false }
            do {
                navigate(.thread(try await connection.fork(chatId, from: message.id)))
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
