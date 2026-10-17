import RelayRemote
import SwiftUI

/// A line across the thread with a note in the middle, for compactions,
/// handoffs and the worktree's setup.
struct StatusRow: View {
    let text: String
    var failed = false
    var action: (label: String, run: () -> Void)?
    @Environment(\.colors) private var colors

    init(_ text: String, failed: Bool = false, action: (label: String, run: () -> Void)? = nil) {
        self.text = text
        self.failed = failed
        self.action = action
    }

    var body: some View {
        HStack(spacing: 12) {
            line
            Text(text)
                .foregroundStyle(failed ? colors.destructive : colors.muted)
                .multilineTextAlignment(.center)
                .layoutPriority(1)
            if let action {
                Button(action.label, action: action.run)
                    .buttonStyle(.plain)
                    .foregroundStyle(colors.accent)
                    .layoutPriority(1)
            }
            line
        }
        .font(.caption)
        .padding(.vertical, 4)
    }

    private var line: some View {
        Rectangle().fill(colors.border).frame(height: 1).frame(minWidth: 12)
    }
}

/// What a folded row opens: a quote-like box under the line.
private struct NoteBox<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.colors) private var colors

    var body: some View {
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .leading) { Rectangle().fill(colors.border).frame(width: 2) }
            .padding(.horizontal, 24)
    }
}

struct HandoffRow: View {
    let message: ChatMessage
    let handoff: AgentHandoff
    @State private var open = false

    var body: some View {
        let from = agentName(handoff.from)
        let to = agentName(handoff.to)
        let switched =
            handoff.computer.map { "Continued on \($0) · \(Clock().clock(message.created))" }
            ?? "Switched from \(from) to \(to)\(handoff.byRelay == true ? " · \(from) couldn't write a note, Relay did" : "")"
        let note = message.body.trimmingCharacters(in: .whitespacesAndNewlines)
        let shown = message.status == "complete" && !note.isEmpty ? note : nil
        VStack(spacing: 6) {
            StatusRow(
                message.streaming
                    ? "\(from) is writing a handoff note for \(handoff.computer ?? to)…"
                    : shown == nil ? "\(switched) · no handoff note" : switched,
                action: shown.map { _ in (open ? "Hide note" : "Show note", { open.toggle() }) })
            if open, let shown {
                NoteBox { MarkdownView(shown, small: true) }
            }
        }
    }
}

/// Where a session was compacted, and the summary the agent kept from it.
struct CompactionRow: View {
    let message: ChatMessage
    @State private var open = false
    @Environment(\.colors) private var colors

    var body: some View {
        let summary = message.compactSummary.flatMap {
            message.status == "complete" && !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? $0 : nil
        }
        VStack(spacing: 6) {
            StatusRow(
                note, failed: message.status == "failed",
                action: summary.map { _ in (open ? "Hide summary" : "Show summary", { open.toggle() }) })
            if open, let summary {
                NoteBox {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(agentName(message.provider)) kept this after compacting")
                            .font(.caption)
                            .foregroundStyle(colors.muted)
                        MarkdownView(summary, small: true)
                    }
                }
            }
        }
    }

    private var note: String {
        switch message.status {
        case "streaming": "Compacting context…"
        case "complete":
            "Context compacted \(compactedTokens(message.compactedFrom, message.context.map { Double($0.usedTokens) }))"
                .trimmingCharacters(in: .whitespaces)
        case "cancelled": "Compaction stopped"
        default: message.signIn == nil ? message.error ?? "Compaction failed" : "Compaction failed"
        }
    }
}

/// What the project's setup or teardown printed.
struct WorktreeCommandRow: View {
    let message: ChatMessage
    let run: WorktreeCommandRun
    @State private var open = false
    @Environment(\.colors) private var colors

    var body: some View {
        let output = worktreeCommandOutput(run)
        VStack(spacing: 6) {
            StatusRow(
                worktreeCommandNote(run, status: message.status),
                failed: message.status == "failed" || message.status == "cancelled",
                action: output.isEmpty ? nil : (open ? "Hide output" : "Show output", { open.toggle() }))
            if open, !output.isEmpty {
                NoteBox {
                    Text("$ \(run.command)\n\(String(output.suffix(4000)))")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(colors.muted)
                        .selectsOnHold("$ \(run.command)\n\(output)", mono: true)
                }
            }
        }
    }
}
