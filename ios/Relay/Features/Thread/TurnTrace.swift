import RelayRemote
import SwiftUI

/// An answer's run of tool calls and commentary, worded as on the desktop
/// (shared/agent-trace): open while the turn runs, folded to its summary
/// ("Read 3 files and ran 2 commands") once it ends.
struct TurnTrace: View {
    let chatId: String
    let message: ChatMessage
    /// The thread's folder, left off the paths it shows.
    let root: String?
    /// The pictures its calls looked at, which their previews open among.
    var looked: [MessageImage] = []
    /// Told whether the trace is open, where the read pictures show under their calls.
    var onOpen: (Bool) -> Void = { _ in }
    /// Open even once it's ended, as a subagent's whole run.
    var startsOpen = false
    /// Nil follows the turn: open while it runs.
    @State private var expanded: Bool?

    var body: some View {
        let turn = Turn(message)
        let open = expanded ?? (turn.live || startsOpen)
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy(duration: 0.25)) { expanded = !open }
            } label: {
                heading(turnHeading(message, expanded: open, turn: turn), open: open)
            }
            .buttonStyle(.plain)
            if open {
                let parts = groupTrace(turn.shown)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(parts) { part in
                        switch part {
                        case .commentary(_, let text):
                            MarkdownView(text, small: true)
                        case .run(let id, let activity):
                            run(activity, batch: turn.live && id == parts.last?.id && !isQuestionCall(activity[0]),
                                alone: parts.count(where: { if case .run = $0 { true } else { false } }) == 1, turn: turn)
                        }
                    }
                    if turn.thinking { ThinkingLine(seed: message.id) }
                }
                .padding(.leading, 4)
                .transition(.opacity)
            }
        }
        .onChange(of: open, initial: true) { onOpen(open) }
    }

    @ViewBuilder private func run(_ activity: [AgentActivity], batch: Bool, alone: Bool, turn: Turn) -> some View {
        if batch {
            let (head, earlier) = batchHead(activity)
            if !earlier.isEmpty {
                Fold(label: summarizeActivity(earlier)) {
                    ForEach(earlier) { row($0, turn) }
                }
            }
            row(head, turn)
        } else if activity.count == 1 || alone {
            ForEach(activity) { row($0, turn) }
        } else {
            Fold(label: summarizeActivity(activity)) {
                ForEach(activity) { row($0, turn) }
            }
        }
    }

    private func row(_ a: AgentActivity, _ turn: Turn) -> some View {
        ToolRow(
            chatId: chatId, messageId: message.id, activity: a, calls: turn.calls[a.id] ?? [], root: root, looked: looked)
    }

    private func heading(_ heading: TurnHeading, open: Bool) -> some View {
        HStack(spacing: 6) {
            switch heading {
            case .working:
                Image(systemName: "wrench.and.screwdriver")
                Text("Working")
            case .call(let a):
                ProgressView().controlSize(.mini)
                Text(liveLabel(a)).lineLimit(1)
            case .writing:
                Image(systemName: "text.cursor")
                Text("Writing")
            case .thinking:
                ProgressView().controlSize(.mini)
                TimelineView(.periodic(from: .now, by: 6)) { context in
                    Text(thinkingWord(message.id, now: Int64(context.date.timeIntervalSince1970 * 1000)))
                }
            case .done(let text):
                Image(systemName: Turn(message).activity.isEmpty ? "brain" : "wrench.and.screwdriver")
                Text(text).lineLimit(open ? nil : 1)
            }
            took
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .rotationEffect(.degrees(open ? 90 : 0))
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .contentShape(.rect)
    }

    @ViewBuilder private var took: some View {
        if message.streaming {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(duration(ms: Int64(context.date.timeIntervalSince1970 * 1000) - message.created))
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
        } else if let ended = message.ended {
            Text((message.status == "cancelled" ? "Stopped after " : "") + duration(ms: ended - message.created))
                .foregroundStyle(.tertiary)
        }
    }
}

/// A run of calls folded behind its summary.
private struct Fold<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.snappy(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.stack.3d.up")
                    Text(label).lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if open {
                content.padding(.leading, 14)
            }
        }
    }
}

/// While the agent thinks between calls: its word for these six seconds.
private struct ThinkingLine: View {
    let seed: String

    var body: some View {
        HStack(spacing: 6) {
            ProgressView().controlSize(.mini)
            TimelineView(.periodic(from: .now, by: 6)) { context in
                Text(thinkingWord(seed, now: Int64(context.date.timeIntervalSince1970 * 1000)))
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}
