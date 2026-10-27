import RelayRemote
import SwiftUI

/// Still, even while it works: the turn's running row is what moves.
struct SubagentMark: View {
    let run: SubagentRun
    @Environment(\.colors) private var colors

    var body: some View {
        Group {
            switch run.status {
            case "running": Circle().fill(colors.accent).frame(width: 7, height: 7).accessibilityLabel("Working")
            case "completed":
                Image(systemName: "checkmark").font(.caption.weight(.semibold)).foregroundStyle(colors.additionText)
                    .accessibilityLabel("Done")
            case "idle": Image(systemName: "circle").font(.caption).foregroundStyle(colors.muted).accessibilityLabel("Child status unavailable")
            case "failed": Image(systemName: "xmark.circle").font(.caption).foregroundStyle(colors.muted).accessibilityLabel("Failed")
            default: Image(systemName: "stop.circle").font(.caption).foregroundStyle(colors.muted).accessibilityLabel("Stopped")
            }
        }
        .frame(width: 18)
    }
}

/// Asks before stopping one: the turn and the other agents carry on.
func confirmStop(_ run: SubagentRun) -> StripConfirm {
    StripConfirm(
        title: "Stop this agent?",
        message: "“\(run.description)” stops where it is. \(leadName(run)) hears it was stopped and carries on; the rest keep working.",
        yes: "Stop agent", no: "Keep it")
}

/// One line over the composer while a fan-out works: how many are out, how many
/// are back, and what the newest working one is on. Threads the thread's agent
/// started share the line: never two strips. It opens the sheet that lists them.
struct SubagentStrip: View {
    let agents: Subagents
    let batch: [SubagentRun]
    /// The started threads to tell of, while any works or asks, and a review's reviewers always.
    let started: [RemoteChatSummary]
    let root: String?
    let open: () -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        let working = batch.filter(\.running)
        VStack(spacing: 0) {
            if !started.isEmpty {
                line {
                    FamilyMark(started: started)
                    Text(slotLine(started, agents: working.count)).foregroundStyle(colors.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let latest = working.max(by: { $0.started < $1.started }) {
                let back = batch.count - working.count
                let what =
                    agents.error != nil ? "Updates paused · open for details"
                    : latest.summary != nil || latest.recent.contains(where: { $0.status == "running" })
                        ? shown(subagentNow(latest)) : latest.description
                line {
                    Image(systemName: "person.2").font(.footnote).foregroundStyle(colors.muted).frame(width: 18)
                    Text(
                        "\(working.count == 1 ? "1 agent working" : "\(working.count) agents working")\(Text(" · \(what)").foregroundStyle(colors.muted))"
                    )
                    .foregroundStyle(colors.foreground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if batch.count > 1 {
                        Text("\(back)/\(batch.count)").monospacedDigit().foregroundStyle(colors.muted)
                    }
                }
            } else if agents.error != nil {
                Button("Couldn't load agents · Retry") { Task { await agents.refresh(connection) } }
                    .font(.subheadline)
                    .foregroundStyle(colors.muted)
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 28)
                    .frame(height: 40)
            }
        }
    }

    private func line<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        Button(action: open) {
            HStack(spacing: 10) {
                content()
                Image(systemName: "chevron.up").font(.caption.weight(.semibold)).foregroundStyle(colors.muted)
            }
            .font(.subheadline)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20))
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
        .accessibilityHint("Lists them, to open one")
    }

    private func shown(_ label: String) -> String {
        guard let root, !root.isEmpty else { return label }
        return label.replacingOccurrences(of: root.hasSuffix("/") ? root : root + "/", with: "")
    }
}

/// The fan-out's agents, kept as they come back. A row opens that agent's run;
/// Stop asks first. It keeps the agents it opened with as they finish, and new
/// ones of the same fan-out join.
struct SubagentsSheet: View {
    let agents: Subagents
    let opened: [SubagentRun]
    let started: [RemoteChatSummary]
    let root: String?
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colors) private var colors
    @State private var ids: [String] = []

    var body: some View {
        let known = ids.isEmpty ? opened.map(\.id) : ids
        let shown = known.compactMap { id in agents.runs.first { $0.id == id } ?? opened.first { $0.id == id } }
            .sorted(by: bySubagentStanding)
        let back = shown.count(where: { !$0.running })
        let working = shown.count - back
        let agentsLine = "Subagents · \(back) of \(shown.count) back"
        let both = !started.isEmpty && !shown.isEmpty
        NavigationStack {
            List {
                if let error = agents.error {
                    Section {
                        Text(error).foregroundStyle(colors.muted)
                        Button("Retry") { Task { await agents.refresh(connection) } }
                    }
                }
                if !shown.isEmpty {
                    Section {
                        ForEach(shown) { run in
                            AgentRow(run: run, root: root, agents: agents) { pick(.subagentRun(chatId: agents.chatId, agentId: run.id)) }
                        }
                    } header: {
                        if both { Text(agentsLine) }
                    } footer: {
                        Text("Stopping one leaves \(leadName(shown[0]))'s turn and the other agents running.")
                    }
                }
                if !started.isEmpty {
                    Section {
                        StartedList(started: started) { pick(.thread($0)) }
                    } header: {
                        if both { Text("Started threads") }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .navigationTitle(
                both ? slotLine(started, agents: working)
                    : !started.isEmpty ? (["Started threads"] + slotLine(started).components(separatedBy: " · ").dropFirst()).joined(separator: " · ")
                    : agentsLine
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", systemImage: "checkmark") { dismiss() } }
            }
        }
        .onAppear { if ids.isEmpty { ids = opened.map(\.id) } }
        // New agents of the same fan-out join while it's open.
        .onChange(of: opened.map(\.id)) { _, now in ids += now.filter { !ids.contains($0) } }
    }

    private func pick(_ route: Route) {
        dismiss()
        navigate(route)
    }
}

private struct AgentRow: View {
    let run: SubagentRun
    let root: String?
    let agents: Subagents
    let open: () -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(alignment: .top, spacing: 10) {
                    SubagentMark(run: run).padding(.top, 3)
                    VStack(alignment: .leading, spacing: 2) {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let now = Int64(context.date.timeIntervalSince1970 * 1000)
                            Text("\(run.description)\(Text("  \(took(ms: (run.ended ?? now) - run.started))").font(.caption).foregroundStyle(colors.muted))")
                                .font(.body.weight(.medium))
                                .foregroundStyle(colors.foreground)
                                .lineLimit(2)
                        }
                        Text(shown(subagentNow(run))).font(.subheadline).foregroundStyle(colors.muted).lineLimit(2)
                        Text(subagentAbout(run)).font(.caption).foregroundStyle(colors.faint).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if run.running && run.canStop != false {
                StripButton(
                    label: "Stop", busyLabel: "Stopping…", failed: "Couldn't stop it", unsure: "Stop may still go through",
                    confirm: confirmStop(run)
                ) { try await agents.stop(run.id, connection) }
            }
        }
    }

    private func shown(_ label: String) -> String {
        guard let root, !root.isEmpty else { return label }
        return label.replacingOccurrences(of: root.hasSuffix("/") ? root : root + "/", with: "")
    }
}
