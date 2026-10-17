import RelayRemote
import SwiftUI

/// The desktop's WatchNotes (src/features/watch, Android's WatchNotes.kt): what the side check
/// flagged in a turn, as a quiet card after the answer. Closing one, any of the three ways,
/// keeps it out of the turn.
struct WatchNotesView: View {
    let chatId: String
    let message: ChatMessage
    @Environment(Connection.self) private var connection
    @Environment(\.renderCompose) private var compose
    @Environment(\.colors) private var colors
    @State private var reading: String?
    /// Hidden at once; the thread's copy catches up when the close lands.
    @State private var closed: Set<String> = []

    /// Older desktops can't take a close from a phone; the notes still read.
    private var closable: Bool { (connection.overview?.bridge ?? 1) >= Bridge.away }

    var body: some View {
        let shown = watchNotes(message.notes).filter { $0.closed != true && !closed.contains($0.id) }
        ForEach(shown) { note in
            card(note)
        }
    }

    private func card(_ note: WatchNote) -> some View {
        let open = reading == note.id
        let agent = agentName(message.provider ?? "")
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Image(systemName: "eye").font(.caption).foregroundStyle(colors.muted)
                Text(note.tag).font(.subheadline.weight(.semibold)).foregroundStyle(colors.foreground)
                Text(note.agent.map { "subagent · \($0.label)" } ?? "this turn")
                    .font(.caption)
                    .foregroundStyle(colors.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if closable {
                    Button { close(note, "dismissed") } label: { Image(systemName: "xmark") }
                        .buttonStyle(.borderless)
                        .font(.caption)
                        .foregroundStyle(colors.muted)
                        .accessibilityLabel("Dismiss")
                }
            }
            Text(note.line).foregroundStyle(colors.foreground)
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    Text(note.title).font(.subheadline.weight(.semibold))
                    if !note.points.isEmpty {
                        MarkdownView(note.points.map { "- \($0)" }.joined(separator: "\n"), small: true)
                    }
                    if let diff = note.diff { diffBox(diff) }
                }
                .padding(.top, 4)
            }
            HStack(spacing: 18) {
                Button(open ? "Less" : "Learn more") { reading = open ? nil : note.id }
                if let compose {
                    Button("Tell \(agent)") {
                        compose(note.steer ?? "About this: \(note.line)", nil)
                        if closable { close(note, "told") }
                    }
                }
                if closable { Button("I know this") { close(note, "known") } }
            }
            .buttonStyle(.borderless)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(colors.muted)
            .padding(.top, 4)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.card, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(colors.border, lineWidth: 0.5))
    }

    private func diffBox(_ diff: WatchDiff) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(diff.file).font(.caption).foregroundStyle(colors.muted).padding(.bottom, 4)
            ForEach(Array(diff.lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        line.hasPrefix("+")
                            ? colors.additionText.opacity(0.14) : line.hasPrefix("-") ? colors.deletionText.opacity(0.14) : .clear)
            }
        }
        .padding(8)
        .background(.codeBackground, in: .rect(cornerRadius: 8))
    }

    private func close(_ note: WatchNote, _ how: String) {
        closed.insert(note.id)
        let read = reading == note.id
        Task {
            do {
                try await connection.liveClient().closeWatchNote(
                    chatId: chatId, messageId: message.id, noteId: note.id, how: how, read: read)
            } catch {
                closed.remove(note.id)
            }
        }
    }
}
