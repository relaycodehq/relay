import RelayRemote
import SwiftUI

/// Where a turn's calls live, for the rows that fetch what the thread left out of them.
struct CallContext {
    let chatId: String
    let messageId: String
    /// The thread's folder, left off the paths it shows.
    let root: String?
    var looked: [MessageImage] = []
    /// Subagents' calls, by the agent call that ran them.
    var subagentCalls: [String: [AgentActivity]] = [:]

    /// A subagent's run has no thread to fetch from.
    var canFetch: Bool { !chatId.isEmpty }
}

/// What a row opens to, call by call: the code it wrote, else what it ran and what came back.
struct RowOpened: View {
    let calls: [AgentActivity]
    let context: CallContext
    @Environment(Connection.self) private var connection

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(calls) { call in
                if showsWritten(call) {
                    WrittenLoader(call: call, context: context)
                } else {
                    CallOutput(call: call, context: context)
                }
            }
        }
    }

    private func showsWritten(_ call: AgentActivity) -> Bool {
        call.wroteCode == true && context.canFetch && connection.canOpenWritten
    }
}

/// Whether a row has anything to open to.
func opensToSomething(_ calls: [AgentActivity]) -> Bool {
    calls.contains { call in
        call.wroteCode == true || call.kind == "command" || !(call.detail ?? "").isEmpty
    }
}

/// The command a call ran and its output, the rest fetched when the thread holds it cut.
struct CallOutput: View {
    let call: AgentActivity
    let context: CallContext
    @Environment(Connection.self) private var connection
    @State private var full: String?

    private var output: String? { full ?? call.detail }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if call.kind == "command" { ToolOutput(text: shown(call.label)) }
            if let output, !output.isEmpty { ToolOutput(text: output) }
        }
        .task { await fetchFull() }
    }

    /// Paths inside the thread's folder read from there.
    private func shown(_ label: String) -> String {
        guard let root = context.root, !root.isEmpty else { return label }
        return label.replacingOccurrences(of: root.hasSuffix("/") ? root : root + "/", with: "")
    }

    private func fetchFull() async {
        guard full == nil, context.canFetch, (call.detailCut ?? 0) > 0 else { return }
        full = try? await connection.activityDetail(context.chatId, message: context.messageId, activity: call.id)
    }
}

/// Fetches what a call wrote on open; without it, the call's output as before.
private struct WrittenLoader: View {
    let call: AgentActivity
    let context: CallContext
    @Environment(Connection.self) private var connection
    @State private var written: [WrittenCode]?
    @State private var missing = false

    var body: some View {
        Group {
            if let written {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(written.enumerated()), id: \.offset) { _, file in
                        WrittenCodeView(file: file, named: written.count > 1)
                    }
                }
            } else if missing {
                CallOutput(call: call, context: context)
            } else {
                Spinner(size: 13).padding(.vertical, 4)
            }
        }
        .task { await fetch() }
    }

    private func fetch() async {
        guard written == nil, !missing else { return }
        let files = try? await connection.activityWritten(context.chatId, message: context.messageId, activity: call.id)
        if let files, !files.isEmpty { written = files } else { missing = true }
    }
}
