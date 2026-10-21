import RelayRemote
import SwiftUI

// The desktop's usage meters and context meter (Android's UsageViews.kt).

private let warnColor = Color(red: 0xE3 / 255, green: 0xA2 / 255, blue: 0x3A / 255)
private let hotColor = Color(red: 0xEF / 255, green: 0x6A / 255, blue: 0x5A / 255)

private func paceColor(_ pace: UsageMeter.Pace, _ fallback: Color) -> Color {
    switch pace {
    case .ok: fallback
    case .warn: warnColor
    case .hot, .spent: hotColor
    }
}

private func contextPace(_ used: Double) -> UsageMeter.Pace { used >= 90 ? .hot : used >= 75 ? .warn : .ok }

extension View {
    /// Asks the agent's plan limits now and every few minutes while the app is in front.
    func pollsUsage(_ provider: String?) -> some View { modifier(PollsUsage(provider: provider)) }

    /// The plan's limits as rings in the toolbar, opening the usage page.
    func usageToolbar(
        provider: String?, context: ContextUsage? = nil, cost: ThreadCost? = nil,
        compact: (() async throws -> Void)? = nil
    ) -> some View {
        modifier(UsageToolbar(provider: provider, context: context, cost: cost, compact: compact))
    }
}

/// The rings in a glass bubble of their own, for a thread, whose bar wants the room for its title.
struct UsageBubble: View {
    let provider: String?
    let context: ContextUsage?
    let cost: ThreadCost?
    let compact: (() async throws -> Void)?
    @State private var open = false

    var body: some View {
        if let provider, reportsUsage(provider) {
            Button { open = true } label: {
                UsageRings(provider: provider)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("\(agentName(provider)) usage")
            .pollsUsage(provider)
            .sheet(isPresented: $open) {
                // A plain sheet: zoomed out of a floating glass view, it left a ghost of the
                // bubble over the sheet and blew the rings up on the way back.
                UsagePage(provider: provider, context: context, cost: cost, compact: compact).fitsSheet()
            }
        }
    }
}

private struct UsageToolbar: ViewModifier {
    let provider: String?
    let context: ContextUsage?
    let cost: ThreadCost?
    let compact: (() async throws -> Void)?
    @State private var open = false
    @Namespace private var transition

    func body(content: Content) -> some View {
        content
            .toolbar {
                if let provider, reportsUsage(provider) {
                    ToolbarItem(placement: .primaryAction) {
                        Button { open = true } label: { UsageRings(provider: provider) }
                    }
                    // The sheet grows out of the button's glass and shrinks back into it.
                    .matchedTransitionSource(id: "usage", in: transition)
                }
            }
            .pollsUsage(provider.flatMap { reportsUsage($0) ? $0 : nil })
            .sheet(isPresented: $open) {
                if let provider {
                    NavigationStack {
                        UsagePage(provider: provider, context: context, cost: cost, compact: compact).fitsSheet()
                    }
                    .navigationTransition(.zoom(sourceID: "usage", in: transition))
                }
            }
    }
}

private struct PollsUsage: ViewModifier {
    let provider: String?
    @Environment(Connection.self) private var connection
    @Environment(\.scenePhase) private var phase

    func body(content: Content) -> some View {
        content.task(id: "\(provider ?? ""):\(phase == .active):\(connection.status.state == .online)") {
            guard let provider, phase == .active else { return }
            while !Task.isCancelled {
                await connection.loadUsage(provider)
                try? await Task.sleep(for: .seconds(180))
            }
        }
    }
}

/// The plan's first two limits as rings, the session outside and the week inside,
/// each arc what's left; bare rings until the first answer. Nothing for an agent
/// without plan limits.
struct UsageRings: View {
    let provider: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        let all = usageMeters(connection.usage[provider], now: nowMs())
        let meters = ["weekly", "session"].compactMap { kind in all.filter { $0.kind == kind }.min { $0.leftPercent < $1.leftPercent } }
        ZStack {
            ForEach(0..<max(1, meters.count), id: \.self) { i in
                let inset = CGFloat(i) * 4
                Circle().stroke(colors.border, lineWidth: 2.4).padding(inset + 1.2)
                if i < meters.count, meters[i].leftPercent > 0 {
                    let m = meters[i]
                    Circle()
                        .trim(from: 0, to: CGFloat(m.leftPercent) / 100)
                        .stroke(
                            paceColor(m.pace, m.kind == "session" ? colors.accent : colors.muted),
                            style: StrokeStyle(lineWidth: 2.4, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                        .padding(inset + 1.2)
                }
            }
        }
        .frame(width: 22, height: 22)
        .accessibilityElement()
        .accessibilityLabel(usageLabel(meters) ?? "\(agentName(provider)) usage")
    }
}

/// Thread settings' usage row: the context window and the plan's limits as thin bars,
/// or what the thread billed for an agent without limits.
struct UsageBars: View {
    let provider: String
    let context: ContextUsage?
    let cost: ThreadCost?
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    /// Whether there's anything to show.
    static func shows(_ provider: String, _ context: ContextUsage?, _ cost: ThreadCost?) -> Bool {
        contextPercent(context) != nil || reportsUsage(provider) || cost != nil
    }

    var body: some View {
        let used = contextPercent(context)
        let limits = reportsUsage(provider)
        let meters = limits ? usageMeters(connection.usage[provider], now: nowMs()) : []
        // Like the desktop, an agent with plan limits shows those instead.
        let spent = limits ? nil : cost
        HStack(spacing: 12) {
            if let used {
                bar("Context", "\(used)%", Double(used), paceColor(contextPace(Double(used)), colors.muted))
            }
            ForEach(meters, id: \.label) { m in
                bar(m.label, "\(m.leftPercent)% left", Double(m.leftPercent),
                    paceColor(m.pace, m.kind == "session" ? colors.accent : colors.muted))
            }
            if limits && meters.isEmpty && used == nil {
                Text("\(agentName(provider)) usage").font(.footnote).foregroundStyle(colors.muted)
            }
            if let spent {
                HStack(spacing: 6) {
                    Text("This thread").foregroundStyle(colors.faint)
                    Text(formatCost(spent.usd)).foregroundStyle(colors.muted)
                }
                .font(.caption)
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            [
                used.map { "Context \($0)% full" }, usageLabel(meters),
                spent.map { "This thread cost \(formatCost($0.usd))" },
            ]
            .compactMap { $0 }.joined(separator: ", "))
    }

    private func bar(_ label: String, _ value: String, _ percent: Double, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).foregroundStyle(colors.faint)
                Spacer(minLength: 4)
                Text(value).foregroundStyle(colors.muted)
            }
            .font(.caption)
            .lineLimit(1)
            UsageTrack(percent: percent, color: color, height: 2)
        }
        .frame(maxWidth: .infinity)
    }
}

/// A bar of how much, with where an even burn would be now.
struct UsageTrack: View {
    let percent: Double
    let color: Color
    var mark: Double?
    var height: CGFloat = 4
    @Environment(\.colors) private var colors

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(colors.border)
                Capsule().fill(color).frame(width: w * min(1, max(0, percent / 100)))
                if let mark {
                    Rectangle()
                        .fill(colors.foreground)
                        .frame(width: 2, height: height + 4)
                        .offset(x: w * min(1, max(0, mark / 100)) - 1)
                }
            }
        }
        .frame(height: height)
    }
}

/// What the usage row, the rings and `/context` open: the context window, what the
/// thread cost, then the plan's limits.
extension UsagePage {
    /// Opened on its own: the sheet as tall as the page instead of the whole screen, titled
    /// without a navigation stack, whose bar laid itself out for a full screen first and then
    /// jumped the rows up as the sheet came in.
    func fitsSheet() -> some View { modifier(FitsSheet(title: "\(agentName(provider)) usage")) }
}

private struct FitsSheet: ViewModifier {
    let title: String
    /// The height it measured last time, so it opens at it rather than at half the screen and
    /// then shrinking to fit; a first guess before it ever opened.
    @AppStorage("usageSheetHeight") private var height = 404.0

    private struct Fit: Equatable {
        let content: CGFloat
        let chrome: CGFloat
    }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                Text(title).font(.headline).frame(maxWidth: .infinity).padding(.top, 20).padding(.bottom, 4)
            }
            // Taken only when the rows change: the insets swing while the sheet slides in and out.
            .onScrollGeometryChange(for: Fit.self, of: { Fit(content: $0.contentSize.height, chrome: $0.contentInsets.top + $0.contentInsets.bottom) }) { old, new in
                if new.content > 0, new.content != old.content { height = new.content + new.chrome }
            }
            .presentationDetents([.height(height), .large])
    }
}

struct UsagePage: View {
    let provider: String
    let context: ContextUsage?
    let cost: ThreadCost?
    /// Compacts the conversation; nil where there's none to compact.
    var compact: (() async throws -> Void)?
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @Environment(\.dismiss) private var dismiss
    @State private var compacting = false
    @State private var error: String?

    var body: some View {
        let usage = connection.usage[provider]
        let meters = usageMeters(usage, now: nowMs())
        Form {
            if let context {
                Section {
                    contextRow(context)
                    if let compact {
                        Button(compacting ? "Compacting…" : "Compact Now") {
                            compacting = true
                            Task {
                                do {
                                    try await compact()
                                    dismiss()
                                } catch {
                                    self.error = error.localizedDescription
                                }
                                compacting = false
                            }
                        }
                        .foregroundStyle(colors.accent)
                        .disabled(compacting)
                    }
                } footer: {
                    if let error { Text(error).foregroundStyle(.red) }
                }
                .cardRow()
            }
            if let cost {
                Section {
                    LabeledContent("This thread", value: formatCost(cost.usd))
                    ForEach(cost.models, id: \.name) { m in
                        LabeledContent(m.name, value: formatCost(m.usd)).foregroundStyle(colors.muted)
                    }
                } footer: {
                    Text("\(cost.answers) \(cost.answers == 1 ? "answer" : "answers") · priced by the agent")
                }
                .cardRow()
            }
            Section {
                if !reportsUsage(provider) {
                    Text("\(agentName(provider)) doesn't report plan limits.").foregroundStyle(colors.muted)
                } else if usage == nil {
                    Spinner(size: 20).frame(maxWidth: .infinity)
                } else if meters.isEmpty {
                    Text(usage?.message ?? "No usage limits reported").foregroundStyle(colors.muted)
                } else {
                    ForEach(meters, id: \.label) { meterRow($0) }
                }
                if reportsUsage(provider) {
                    Button("Check Again") { Task { await connection.loadUsage(provider, force: true) } }
                        .foregroundStyle(colors.accent)
                }
            } header: {
                Text("Plan limits")
            }
            .cardRow()
        }
        .scrollContentBackground(.hidden)
        .presentationBackground(colors.background)
        .navigationTitle("\(agentName(provider)) usage")
        .navigationBarTitleDisplayMode(.inline)
        .task { await connection.loadUsage(provider) }
    }

    private func contextRow(_ context: ContextUsage) -> some View {
        let used = context.maxTokens.flatMap { $0 > 0 ? min(100, Double(context.usedTokens) * 100 / Double($0)) : nil }
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Context")
                Spacer()
                Text(
                    formatTokens(Double(context.usedTokens))
                        + (context.maxTokens.map { " of \(formatTokens(Double($0)))" } ?? "")
                        + (used.map { " · \(Int($0.rounded()))% full" } ?? "")
                )
                .foregroundStyle(colors.muted)
            }
            if let used { UsageTrack(percent: used, color: paceColor(contextPace(used), colors.accent)) }
            if let total = context.totalTokens {
                Text("\(formatTokens(Double(total))) tokens through the session so far")
                    .font(.footnote)
                    .foregroundStyle(colors.muted)
            }
        }
        .padding(.vertical, 4)
    }

    private func meterRow(_ m: UsageMeter) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(m.label)
                Spacer()
                Text("\(m.leftPercent)% left").foregroundStyle(paceColor(m.pace, colors.muted))
            }
            UsageTrack(percent: Double(m.leftPercent), color: paceColor(m.pace, colors.accent), mark: m.paceLeftPercent)
            let hint = [paceGap(m), m.limitLabel, m.resetLabel].compactMap { $0 }.joined(separator: " · ")
            if !hint.isEmpty { Text(hint).font(.footnote).foregroundStyle(colors.muted) }
        }
        .padding(.vertical, 4)
    }
}
