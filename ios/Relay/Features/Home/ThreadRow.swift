import RelayRemote
import SwiftUI

/// A thread in a list (Android's ThreadRow.kt): what it's doing, where, and when it last moved.
struct ThreadRow: View {
    let chat: RemoteChatSummary
    /// The project's name; left out inside the project itself.
    var project: String?
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        let agents = chat.running == true ? nil : agentsSince(chat.pending)
        let working = chat.running == true || agents != nil
        let blocked = inputBlocksThread(chat)
        HStack(spacing: 12) {
            Group {
                if blocked {
                    Image(systemName: "questionmark.circle").foregroundStyle(colors.accent)
                        .accessibilityLabel("Waiting for you")
                } else if working {
                    ProgressView().controlSize(.mini)
                } else if let provider = chat.provider {
                    ProviderMark(provider: provider).foregroundStyle(colors.muted)
                }
            }
            .font(.system(size: 15))
            .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(chat.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(colors.foreground)
                    .lineLimit(1)
                let draft = connection.draft(of: chat.id)
                TimelineView(.everyMinute) { context in
                    let now = Int64(context.date.timeIntervalSince1970 * 1000)
                    // A draft's text where the branch would be.
                    let rest = draft.map { Text(" · \(draftText($0))").foregroundStyle(colors.waiting) }
                        ?? Text(place).foregroundStyle(colors.muted)
                    Text("\(Text(state(now, agents: agents, blocked: blocked)).foregroundStyle(chat.waiting == true ? colors.accent : colors.muted))\(draft == nil ? Text("") : Text(project.map { " · \($0)" } ?? "").foregroundStyle(colors.muted))\(rest)")
                        .font(.footnote)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 9)
        .draftTint(connection.draft(of: chat.id) != nil)
        .contentShape(.rect)
    }

    /// A native /goal keeps the agent going across turns until it's met.
    private var goal: ThreadGoal? { chat.running == true && chat.goal?.status == "active" ? chat.goal : nil }

    private func state(_ now: Int64, agents: Int64?, blocked: Bool) -> String {
        if blocked { return "Waiting for you" }
        if chat.running == true || agents != nil {
            return "\(goal != nil ? "Goal" : "Working")\(chat.waiting == true ? " · needs input" : "") · "
                + ago(agents ?? chat.runningSince ?? chat.updated, now: now)
        }
        return ago(chat.updated, now: now)
    }

    private var place: String {
        var parts: [String] = []
        if let project { parts.append(project) }
        if let goal { parts.append(goal.objective) } else if let branch = chat.branch { parts.append(branch) }
        return parts.map { " · \($0)" }.joined()
    }
}
