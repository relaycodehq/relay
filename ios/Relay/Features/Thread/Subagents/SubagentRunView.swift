import RelayMarkdown
import RelayRemote
import SwiftUI

/// The desktop's SubagentThread as a screen: the brief the thread's agent gave
/// one, its text and calls drawn as a turn, and what it reported. Read-only,
/// with Stop while it works.
struct SubagentRunView: View {
    let chatId: String
    let agentId: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var model: SubagentRunModel

    init(chatId: String, agentId: String) {
        self.chatId = chatId
        self.agentId = agentId
        _model = State(initialValue: SubagentRunModel(chatId: chatId, agentId: agentId))
    }

    private var root: String? { connection.threads[chatId]?.root }

    var body: some View {
        Group {
            if let run = model.run {
                ScrollView {
                    RunBody(run: run, root: root)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                }
                .defaultScrollAnchor(.bottom, for: .sizeChanges)
            } else if !connection.canSeeSubagents {
                note("Update Relay on your computer to read an agent's run here.")
            } else if model.loaded {
                note("This agent's run is gone: the session that ran it ended.")
            } else if let error = model.error {
                VStack(spacing: 12) {
                    note(error)
                    Button("Retry") { Task { await model.refresh(connection) } }.buttonStyle(.glass)
                }
            } else {
                Spinner.page
            }
        }
        .safeAreaBar(edge: .bottom) {
            HStack(spacing: 12) {
                Text("Read-only. Agents take instructions from \(model.run.map(leadName) ?? "the thread's agent"), not from you.")
                    .font(.caption)
                    .foregroundStyle(colors.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let run = model.run, run.running, run.canStop != false {
                    StripButton(
                        label: "Stop agent", busyLabel: "Stopping…", failed: "Couldn't stop it",
                        unsure: "Stop may still go through", confirm: confirmStop(run)
                    ) { try await model.stop(connection) }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
        }
        .relayBackground()
        .navigationTitle(model.run.map(agentKind) ?? "Agent")
        .navigationBarTitleDisplayMode(.inline)
        .subagentPoll(enabled: true, again: !model.loaded || model.run?.running == true) { await model.refresh(connection) }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(colors.muted)
            .multilineTextAlignment(.center)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct RunBody: View {
    let run: SubagentRun
    let root: String?
    @Environment(\.colors) private var colors
    @State private var whole = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    SubagentMark(run: run)
                    Text(run.description).font(.title3.weight(.semibold))
                }
                Text(subagentAbout(run) + (run.status == "failed" ? " · failed" : ""))
                    .font(.subheadline)
                    .foregroundStyle(colors.muted)
                    .padding(.leading, 26)
            }
            if let brief = run.brief, !brief.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    label("\(leadName(run))'s brief")
                    Text(brief)
                        .lineLimit(whole ? nil : 5)
                        .selectsOnHold(brief)
                    if !whole && brief.count > 220 {
                        Button("Show all") { whole = true }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(colors.accent)
                            .buttonStyle(.plain)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(colors.fill, in: .rect(cornerRadius: 12))
            }
            // Its tool output comes cut, as a thread's does, with no turn to fetch the rest or its pictures from.
            TurnTrace(chatId: "", message: subagentMessage(run), root: root, startsOpen: true)
            if !run.running, let report = run.report, !report.isEmpty {
                label("Reported to \(leadName(run))")
                MarkdownView(report)
            }
            if run.status == "stopped" {
                Text("Stopped. \(leadName(run)) hears it was and carries on without it.").foregroundStyle(colors.muted)
            }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(colors.muted)
    }
}
