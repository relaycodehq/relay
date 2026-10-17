import RelayRemote
import SwiftUI

/// The thread's native `/goal`, as the desktop's row shows it. `/goal pause`,
/// `resume` and `clear` typed in the composer act on it.
struct GoalStrip: View {
    let goal: ThreadGoal
    let running: Bool
    @Environment(\.colors) private var colors

    var body: some View {
        let shown = presentGoal(goal, running: running)
        Strip {
            StripLine(
                icon: "target", tint: shown.working ? colors.accent : nil, head: shown.title,
                tail: " · \(shown.objective)\(shown.usage.isEmpty ? "" : " · \(shown.usage)")", lines: 3)
            if let detail = shown.detail {
                Text(detail).font(.caption).foregroundStyle(colors.muted).lineLimit(2)
            }
        }
    }
}

/// A usage limit stopped the answer; the desktop carries it on once the limit lifts.
struct LimitStrip: View {
    let chatId: String
    let plan: LimitResume
    @Environment(Connection.self) private var connection

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            if let line = limitLine(plan, now: Int64(context.date.timeIntervalSince1970 * 1000)) {
                Strip {
                    StripLine(icon: "hourglass", head: line.title, tail: line.detail) {
                        if plan.off == true {
                            StripButton(label: "Resume then", failed: "Couldn't change it", primary: true) { try await set(true) }
                        } else {
                            StripButton(label: "Don't resume", failed: "Couldn't change it") { try await set(false) }
                        }
                    }
                }
            }
        }
    }

    private func set(_ on: Bool) async throws {
        try await connection.liveClient().setLimitResume(chatId: chatId, on)
        // The strip reads the thread list's copy.
        await connection.reloadList()
    }
}

/// Work that ended when Relay closed, until picked back up or dismissed.
struct StoppedStrip: View {
    let chatId: String
    let items: [ChatPending]
    @Environment(Connection.self) private var connection

    var body: some View {
        let line = stoppedLine(items)
        Strip {
            StripLine(icon: "stop.circle", head: line.title, tail: line.detail)
            HStack(spacing: 8) {
                Spacer()
                StripButton(label: "Dismiss", failed: "Couldn't dismiss it", unsure: "Dismiss may still go through") {
                    try await resolve("dismiss")
                }
                StripButton(
                    label: "Pick it back up", failed: "Couldn't pick it back up", unsure: "It may still pick back up",
                    primary: true
                ) { try await resolve("resume") }
            }
        }
    }

    private func resolve(_ action: String) async throws {
        try await connection.liveClient().resolveStoppedWork(chatId: chatId, action)
        await connection.load(chatId)
    }
}

/// Work Claude left running that starts its next turn by itself. More than one
/// folds into a line that opens to the list, so a few servers don't push the
/// thread off the screen.
struct WaitingStrip: View {
    let chatId: String
    let pending: [ChatPending]
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var open = false

    var body: some View {
        if let first = pending.first {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let now = Int64(context.date.timeIntervalSince1970 * 1000)
                let (title, detail) = waitingSummary(pending, now: now)
                Strip {
                    if pending.count == 1 {
                        StripLine(icon: icon(first), head: title, tail: detail) { stop(first) }
                    } else {
                        Button {
                            withAnimation(.snappy(duration: 0.2)) { open.toggle() }
                        } label: {
                            StripLine(icon: icon(first), head: title, tail: detail) {
                                Image(systemName: "chevron.up")
                                    .font(.caption.weight(.semibold))
                                    .rotationEffect(.degrees(open ? 180 : 0))
                                    .foregroundStyle(colors.muted)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(open ? "Hides the list" : "Shows each one with Stop")
                        if open {
                            ForEach(pending, id: \.id) { item in
                                StripLine(
                                    icon: icon(item), head: pendingWhat(item),
                                    tail: timing(item, now: now).map { " · \($0)" } ?? ""
                                ) { stop(item) }
                            }
                        }
                    }
                }
            }
        }
    }

    private func icon(_ item: ChatPending) -> String { item.kind == "task" ? "terminal" : "alarm" }

    private func stop(_ item: ChatPending) -> some View {
        let task = item.kind == "task"
        return StripButton(
            label: task ? "Stop" : "Cancel", busyLabel: task ? "Stopping…" : "Cancelling…",
            failed: task ? "Couldn't stop it" : "Couldn't cancel it",
            unsure: task ? "Stop may still go through" : "Cancel may still go through"
        ) {
            try await connection.liveClient().stopPending(chatId: chatId, itemId: item.id)
            await connection.load(chatId)
        }
    }
}

/// A settled thread, opened: the next message unsettles it.
struct SettledStrip: View {
    let chatId: String
    /// Settled while its answer runs.
    let whenDone: Bool
    @Environment(Connection.self) private var connection

    var body: some View {
        Strip {
            StripLine(
                icon: "checkmark.circle", head: whenDone ? "Settles when done" : "Settled",
                tail: " · replying unsettles it"
            ) {
                StripButton(label: "Unsettle", failed: "Couldn't move it back", unsure: "It may still move back") {
                    _ = try await connection.triage(chatId, .unsettle)
                }
            }
        }
    }
}
