import RelayRemote
import SwiftUI

extension View {
    /// CI on the thread's branch in the toolbar, as the desktop's thread header shows it.
    func ciStatus(projectId: String?, chatId: String, running: Bool, shown: Bool) -> some View {
        modifier(CiToolbar(projectId: projectId, chatId: chatId, running: running, shown: shown))
    }
}

/// One mark for the overall state, and the runs behind it a tap away
/// (Android's CiStatusButton.kt). Shows nothing until a run has a verdict.
/// `running` is whether the agent works: it may push, so its end looks again.
private struct CiToolbar: ViewModifier {
    let projectId: String?
    let chatId: String
    let running: Bool
    let shown: Bool
    @Environment(Connection.self) private var connection
    @Environment(\.scenePhase) private var phase
    @Environment(\.colors) private var colors
    @State private var ci: CiStatus?
    @State private var open = false

    func body(content: Content) -> some View {
        let summary = ci.flatMap { ciSummary($0.runs) }
        content
            .toolbar {
                if shown, let ci, let summary {
                    ToolbarItem(placement: .primaryAction) {
                        Button { open = true } label: {
                            Image(systemName: ciIcon(summary.state)).foregroundStyle(ciColor(summary.state, colors))
                        }
                        .accessibilityLabel("\(ciLabel(summary.state)) on \(ci.branch)")
                    }
                }
            }
            .sheet(isPresented: $open) {
                if let ci { CiSheet(ci: ci) }
            }
            // Now and every minute while on screen and the app in front.
            .task(id: Live(projectId: projectId, on: shown && connection.status.state == .online && phase == .active)) {
                guard let projectId, shown, connection.status.state == .online, phase == .active else { return }
                while !Task.isCancelled {
                    await load(projectId)
                    try? await Task.sleep(for: .seconds(60))
                }
            }
            .onChange(of: running) { was, now in
                if was, !now, let projectId { Task { await load(projectId) } }
            }
    }

    private func load(_ projectId: String) async {
        ci = try? await connection.liveClient().ciStatus(projectId, chatId: chatId)
    }

    private struct Live: Equatable {
        let projectId: String?
        let on: Bool
    }
}

private func ciIcon(_ state: String) -> String {
    switch state {
    case "success": "checkmark.circle"
    case "failure": "xmark.circle"
    // Still, not spinning: the header stays calm while an agent works.
    default: "circle.dashed"
    }
}

private func ciColor(_ state: String, _ colors: RelayColors) -> Color {
    switch state {
    case "success": colors.additionText
    case "failure": colors.destructive
    case "running": colors.accent
    default: colors.muted
    }
}

/// The runs on the commit CI last saw, each opening on the CI host.
private struct CiSheet: View {
    let ci: CiStatus
    @Environment(\.colors) private var colors
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let message = ci.commit.message, !message.isEmpty {
                    Text("\(ci.commit.sha.prefix(7)) · \(message.split(separator: "\n").first.map(String.init) ?? "")")
                        .font(.subheadline)
                        .foregroundStyle(colors.muted)
                        .lineLimit(2)
                        .listRowBackground(Color.clear)
                }
                if ci.ahead > 0 {
                    Text((ci.ahead == 1 ? "1 newer commit hasn’t" : "\(ci.ahead) newer commits haven’t") + " run yet.")
                        .font(.subheadline)
                        .foregroundStyle(colors.muted)
                        .listRowBackground(Color.clear)
                }
                Section {
                    ForEach(ci.runs, id: \.self) { run in
                        Button {
                            if let url = URL(string: run.url) { openURL(url) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: ciIcon(run.state))
                                    .foregroundStyle(ciColor(run.state, colors))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(run.workflow).foregroundStyle(colors.foreground).lineLimit(1)
                                    Text((run.failedJob.map { "\($0) failed · " } ?? "") + shortAge(run.at, now: nowMs()))
                                        .font(.footnote)
                                        .foregroundStyle(colors.muted)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "arrow.up.right.square")
                                    .font(.footnote)
                                    .foregroundStyle(colors.muted)
                                    .accessibilityLabel("Open \(run.workflow)")
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                    }
                } header: {
                    if !ci.source.isEmpty { GitSectionHeader(title: ci.source) }
                }
            }
            .listStyle(.plain)
            .navigationTitle("CI on \(ci.branch)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
