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

/// What a row opens to, call by call: the code it wrote, then what it ran and what came back.
struct RowOpened: View {
    let rows: [TraceRow]
    let calls: [AgentActivity]
    let context: CallContext
    @Environment(Connection.self) private var connection

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(calls) { call in
                if showsWritten(call) {
                    WrittenLoader(call: call, rows: rows, context: context)
                }
                if showsOutput(call) {
                    CallOutput(call: call, context: context, printed: printedHere(call))
                }
            }
        }
    }

    private func showsWritten(_ call: AgentActivity) -> Bool {
        call.wroteCode == true && context.canFetch && connection.canOpenWritten
    }

    /// What a call printed, unless it only confirms the code shown above it; a failure always says
    /// why, and a command that wrote a script shows what running it printed.
    private func showsOutput(_ call: AgentActivity) -> Bool {
        !showsWritten(call) || call.kind == "command" || call.status == "failed"
    }

    /// A call that did several things prints under the row of the first only; the others show what ran.
    private func printedHere(_ call: AgentActivity) -> Bool {
        rows.contains { row in row.calls.contains { $0.id == call.id } && RelayRemote.showsOutput(row, call) }
    }
}

/// Whether a file a call wrote belongs under these rows: a call that wrote three files has a row
/// for each. A file none of the call's actions names, its opener cut off the label, goes with
/// whichever row opens.
private func writtenFor(_ rows: [TraceRow], _ call: AgentActivity, path: String) -> Bool {
    let about = Set(rows.compactMap { writtenFile($0.action) })
    let named = Set((call.actions ?? []).compactMap(writtenFile))
    return about.contains(path) || !named.contains(path)
}

private func writtenFile(_ action: CallAction) -> String? {
    ["edit", "create", "delete"].contains(action.kind) ? action.file : nil
}

/// Whether a row has anything to open to.
func opensToSomething(_ calls: [AgentActivity]) -> Bool {
    calls.contains { call in
        call.wroteCode == true || call.kind == "command" || !(call.detail ?? "").isEmpty
    }
}

/// The command a call ran and its output, the rest fetched when the thread holds it cut.
/// A read of one file shows the file's lines instead, once the phone has all of them.
struct CallOutput: View {
    let call: AgentActivity
    let context: CallContext
    /// Whether what it printed shows here, or only what it ran.
    var printed = true
    @Environment(Connection.self) private var connection
    @State private var full: String?

    private var output: String? { full ?? call.detail }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let read = wholeRead() {
                ReadCodeView(read: read)
            } else {
                if call.kind == "command" { ToolOutput(text: shown(call.label)) }
                if printed, let output, !output.isEmpty { ToolOutput(text: output) }
            }
        }
        // Output still coming in is cut again with every update; the rest is fetched once it's all there.
        .task(id: "\(call.status) \(call.detailCut ?? 0)") { await fetchFull() }
    }

    /// Numbering a preview cut in the middle would drop its end, so it shows plain until the rest comes.
    private func wholeRead() -> ReadCode? {
        guard outputIsWhole else { return nil }
        var whole = call
        whole.detail = output
        return readCode(whole)
    }

    private var outputIsWhole: Bool {
        if full != nil { return true }
        if (call.detailCut ?? 0) > 0 { return false }
        // A subagent's calls come cut without saying how much is missing, only the mark in the middle.
        return context.canFetch || !(call.detail ?? "").contains("\n…\n")
    }

    /// Paths inside the thread's folder read from there.
    private func shown(_ label: String) -> String {
        guard let root = context.root, !root.isEmpty else { return label }
        return label.replacingOccurrences(of: root.hasSuffix("/") ? root : root + "/", with: "")
    }

    private func fetchFull() async {
        guard call.status != "running", context.canFetch, (call.detailCut ?? 0) > 0 else { return }
        full = try? await connection.activityDetail(context.chatId, message: context.messageId, activity: call.id)
    }
}

/// Fetches what a call wrote on open; without it, the call's output as before.
private struct WrittenLoader: View {
    let call: AgentActivity
    /// The rows it opens under, which say which of the call's files to show.
    let rows: [TraceRow]
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
                // A command's or a failed call's output already shows beside this.
                if call.status != "failed", call.kind != "command" { CallOutput(call: call, context: context) }
            } else {
                Spinner(size: 13).padding(.vertical, 4)
            }
        }
        .task { await fetch() }
    }

    private func fetch() async {
        guard written == nil, !missing else { return }
        let files = try? await connection.activityWritten(context.chatId, message: context.messageId, activity: call.id)
        if let files, !files.isEmpty { written = files.filter { writtenFor(rows, call, path: $0.path) } } else { missing = true }
    }
}
