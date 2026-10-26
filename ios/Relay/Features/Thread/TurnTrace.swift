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
                let oneRun = parts.count(where: { if case .run = $0 { true } else { false } }) == 1
                // A running turn shows its newest steps and folds the rest. One row thousands of points
                // tall makes the lazy stack guess every unmeasured row that tall, and the end it scrolls
                // to drifts past the thread when the turn folds or a steer ends it.
                let cut = turn.live ? max(0, parts.count - liveSteps) : 0
                VStack(alignment: .leading, spacing: 6) {
                    if cut > 0 {
                        let earlier = summarizeActivity(parts[..<cut].flatMap { part -> [AgentActivity] in
                            if case .run(_, let a) = part { a } else { [] }
                        })
                        Fold(label: earlier.isEmpty ? "Earlier" : earlier) {
                            ForEach(parts[..<cut]) { self.part($0, last: parts.last?.id, only: oneRun, turn: turn) }
                        }
                    }
                    ForEach(parts[cut...]) { self.part($0, last: parts.last?.id, only: oneRun, turn: turn) }
                    if turn.thinking { ThinkingLine(seed: message.id) }
                }
                .padding(.leading, 4)
                .transition(.opacity)
            }
        }
        .onChange(of: open, initial: true) { onOpen(open) }
    }

    @ViewBuilder private func part(_ part: TracePart, last: String?, only: Bool, turn: Turn) -> some View {
        switch part {
        case .commentary(_, let text):
            MarkdownView(text, small: true)
        case .run(let id, let activity):
            run(activity, live: turn.live && id == last && !isQuestionCall(activity[0]), only: only, turn: turn)
        }
    }

    /// The run the agent works on shows its calls one by one; the rest are grouped by what they did.
    @ViewBuilder private func run(_ activity: [AgentActivity], live: Bool, only: Bool, turn: Turn) -> some View {
        if saysWhatItDid(activity) {
            CallRun(calls: activity, live: live, only: only, context: context(turn))
        } else if live || activity.count == 1 || only {
            // An older desktop doesn't say what its calls did: they keep a row each.
            ForEach(activity) { row($0, turn) }
        } else {
            Fold(label: summarizeActivity(activity)) {
                ForEach(activity) { row($0, turn) }
            }
        }
    }

    private func context(_ turn: Turn) -> CallContext {
        CallContext(chatId: chatId, messageId: message.id, root: root, looked: looked, subagentCalls: turn.calls)
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
                Spinner(size: 13)
                Text(liveLabel(a)).lineLimit(1).layoutPriority(-1)
            case .writing:
                Image(systemName: "text.cursor")
                Text("Writing")
            case .thinking:
                Spinner(size: 13)
                TimelineView(.periodic(from: .now, by: 6)) { context in
                    Text(thinkingWord(message.id, now: Int64(context.date.timeIntervalSince1970 * 1000)))
                }
            case .done(let text):
                Image(systemName: Turn(message).activity.isEmpty ? "brain" : "wrench.and.screwdriver")
                // One line, cut short: the time and chevron after it always show whole.
                Text(text).lineLimit(1).truncationMode(.tail).layoutPriority(-1)
            }
            took.fixedSize()
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .rotationEffect(.degrees(open ? 90 : 0))
                .fixedSize()
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
                    .opacity(0.7)
            }
        } else if let ended = message.ended {
            // The summary's grey, a little quieter, as on the desktop and Android.
            Text((message.status == "cancelled" ? "Stopped after " : "") + duration(ms: ended - message.created))
                .opacity(0.7)
        }
    }
}

/// How many of a running turn's newest steps stay open.
private let liveSteps = 8

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
            Spinner(size: 13)
            TimelineView(.periodic(from: .now, by: 6)) { context in
                Text(thinkingWord(seed, now: Int64(context.date.timeIntervalSince1970 * 1000)))
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}
