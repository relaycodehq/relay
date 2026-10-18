import RelayRemote
import SwiftUI

/// Dev servers and processes the project's agents left running; stop or restart them
/// (Android's TasksScreen.kt). Processes come and go on their own, so it looks again every
/// few seconds while open.
struct TasksView: View {
    let projectId: String
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors
    @State private var tasks: [ProjectTask]?
    @State private var error: String?
    /// Task id → "restart" | "stop" while that runs.
    @State private var busy: [String: String] = [:]
    @State private var stopping: ProjectTask?
    @State private var failure: (title: String, message: String)?

    var body: some View {
        List {
            if let tasks {
                ForEach(tasks) { task in
                    TaskCard(
                        task: task, busy: busy[task.id],
                        open: connection.canTunnel ? { navigate(.browser(url: SiteAddress(port: $0).href)) } : nil,
                        restart: { restart(task) }, stop: { stopping = task })
                }
                if tasks.isEmpty {
                    Text("Nothing is running in this project.")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                        .activityRow()
                }
            } else if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(colors.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .activityRow()
            } else {
                Spinner(size: 20).frame(maxWidth: .infinity).padding(.vertical, 24).activityRow()
            }
        }
        .listStyle(.plain)
        .relayBackground()
        .navigationTitle("Tasks")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: connection.status.state == .online) {
            guard connection.status.state == .online else { return }
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(3))
            }
        }
        .confirmationDialog(
            "Stop \(stopping?.title ?? "it")?",
            isPresented: Binding(get: { stopping != nil }, set: { if !$0 { stopping = nil } }), titleVisibility: .visible,
            presenting: stopping
        ) { task in
            Button("Stop", role: .destructive) { stop(task) }
        } message: { task in
            Text(task.command)
        }
        .alert(
            failure?.title ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
        ) {
            Button("OK") {}
        } message: {
            Text(failure?.message ?? "")
        }
    }

    private func load() async {
        do {
            tasks = try await connection.liveClient().projectTasks(projectId: projectId)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func restart(_ task: ProjectTask) {
        run(task, "restart", failed: "Couldn't restart it") {
            try await connection.liveClient().restartProjectTask(projectId: projectId, taskId: task.id)
        }
    }

    private func stop(_ task: ProjectTask) {
        run(task, "stop", failed: "Couldn't stop it", unsure: "Stop may still go through.") {
            try await connection.liveClient().stopProjectTask(projectId: projectId, taskId: task.id)
        }
    }

    private func run(
        _ task: ProjectTask, _ what: String, failed: String, unsure: String? = nil, _ job: @escaping () async throws -> Void
    ) {
        busy[task.id] = what
        Task {
            defer { busy[task.id] = nil }
            do {
                try await job()
                await load()
            } catch {
                failure = (failed, [error.localizedDescription, unsure].compactMap { $0 }.joined(separator: " "))
            }
        }
    }
}

private struct TaskCard: View {
    let task: ProjectTask
    let busy: String?
    let open: ((Int) -> Void)?
    let restart: () -> Void
    let stop: () -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(task.title).font(.body.weight(.semibold)).foregroundStyle(colors.foreground)
            Text(task.command)
                .font(.mono(.caption))
                .foregroundStyle(colors.muted)
                .lineLimit(3)
                .textSelection(.enabled)
            TimelineView(.periodic(from: .now, by: 30)) { context in
                Text(taskMeta(task, now: Int64(context.date.timeIntervalSince1970 * 1000)))
                    .font(.caption)
                    .foregroundStyle(colors.muted)
            }
            // A task can listen on a few ports; their buttons wrap.
            FlowButtons {
                if let open {
                    ForEach(task.ports, id: \.self) { port in
                        Button("Open :\(String(port))") { open(port) }
                    }
                }
                Button(busy == "restart" ? "Restarting…" : "Restart", action: restart).disabled(busy != nil)
                Button(busy == "stop" ? "Stopping…" : "Stop", role: .destructive, action: stop).disabled(busy != nil)
            }
            .padding(.top, 4)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.card, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(colors.border, lineWidth: 0.5))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }
}

/// Small glass buttons, right-aligned, wrapping onto a new row when they don't fit.
private struct FlowButtons<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        FlowLayout(spacing: 8) { content }
            .buttonStyle(.glass)
            .controlSize(.small)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(subviews, width: proposal.width ?? .infinity)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews, width: bounds.width) {
            var x = bounds.maxX - row.width
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            let next = row.items.isEmpty ? size.width : row.width + spacing + size.width
            if !row.items.isEmpty && next > width {
                rows.append(row)
                row = Row()
            }
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append(i)
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}
