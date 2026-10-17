import RelayRemote
import SwiftUI

/// One tool call: what it ran or touched, and a tap away its output and the
/// calls its subagent made. The desktop sends long output cut; opening the
/// row fetches the rest.
struct ToolRow: View {
    let chatId: String
    let messageId: String
    let activity: AgentActivity
    /// A subagent's own calls.
    let calls: [AgentActivity]
    let root: String?
    var looked: [MessageImage] = []
    @Environment(Connection.self) private var connection
    @State private var open = false
    @State private var full: String?

    private var question: Bool { isQuestionCall(activity) }
    private var detail: String? { full ?? activity.detail }
    private var opens: Bool { !calls.isEmpty || !(detail ?? "").isEmpty || !(askedQuestions(activity) ?? []).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // A tap folds it, a hold selects what it ran or touched. Not a Button:
            // a held button still fires its tap on release.
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                icon.frame(width: 16)
                label
                if opens {
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .foregroundStyle(.tertiary)
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .contentShape(.rect)
            .onTapGesture {
                guard opens else { return }
                withAnimation(.snappy(duration: 0.2)) { open.toggle() }
            }
            .accessibilityAddTraits(opens ? .isButton : [])
            .selectsOnHold(question ? doneLabel(activity) : activity.label, mono: activity.kind == "command")
            // A subagent's run has no turn to read its pictures from.
            if !chatId.isEmpty, looksAtImage(activity), let path = imagePath(activity) {
                ReadPreview(
                    source: .read(chatId: chatId, messageId: messageId, path: path), name: fileName(path),
                    done: activity.status == "complete", among: looked
                )
                .padding(.leading, 24)
                .id(path)
            }
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(calls) { call in
                        ToolRow(chatId: chatId, messageId: messageId, activity: call, calls: [], root: root, looked: looked)
                    }
                    if question, let asked = askedQuestions(activity) {
                        ForEach(Array(asked.enumerated()), id: \.offset) { _, pair in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(pair.question).foregroundStyle(.secondary)
                                Text(pair.answer)
                            }
                            .font(.footnote)
                        }
                    } else if let detail, !detail.isEmpty {
                        Detail(text: detail)
                    }
                }
                .padding(.leading, 24)
                .task { await fetchFull() }
            }
        }
    }

    @ViewBuilder private var icon: some View {
        if activity.status == "running" {
            Spinner(size: 13)
        } else {
            Image(systemName: symbol)
                .foregroundStyle(activity.status == "failed" ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
        }
    }

    private var symbol: String {
        if question { return "questionmark.bubble" }
        if activity.status == "failed" { return "xmark.circle" }
        if activity.status == "stopped" { return "stop.circle" }
        switch activity.kind {
        case "command": return "terminal"
        case "read": return "doc.text"
        case "file": return "pencil"
        case "search": return "magnifyingglass"
        case "web": return "globe"
        case "agent": return "person.crop.circle.badge.checkmark"
        default: return "wrench"
        }
    }

    @ViewBuilder private var label: some View {
        if question {
            Text(activity.status == "running" ? liveLabel(activity) : doneLabel(activity))
        } else {
            let text = shown(activity.label)
            HStack(spacing: 4) {
                Text(text)
                    .font(activity.kind == "command" ? .system(.footnote, design: .monospaced) : .footnote)
                    .lineLimit(open ? 6 : 2)
                if activity.kind == "agent", let progress = activity.progress, !progress.isEmpty {
                    Text("· \(progress)").lineLimit(1).foregroundStyle(.tertiary)
                }
            }
        }
    }

    /// Paths inside the thread's folder read from there.
    private func shown(_ label: String) -> String {
        guard let root, !root.isEmpty else { return label }
        let prefix = root.hasSuffix("/") ? root : root + "/"
        return label.replacingOccurrences(of: prefix, with: "")
    }

    private func fetchFull() async {
        guard full == nil, (activity.detailCut ?? 0) > 0 else { return }
        full = try? await connection.activityDetail(chatId, message: messageId, activity: activity.id)
    }
}

private struct Detail: View {
    let text: String

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .padding(10)
        }
        .scrollIndicators(.hidden)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(maxHeight: 220)
        .fixedSize(horizontal: false, vertical: true)
        .background(.codeBackground, in: .rect(cornerRadius: 10))
        .selectsOnHold(text, mono: true)
    }
}
