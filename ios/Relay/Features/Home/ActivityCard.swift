import RelayRemote
import SwiftUI

/// The threads a lead's agent started, listed under it unless folded.
struct CardFamily {
    let started: [RemoteChatSummary]
    let open: Bool
    let fold: () -> Void
}

/// One open thread in Activity (Android's ActivityCard.kt): what it's doing, where, how long.
struct ActivityCard: View {
    let chat: RemoteChatSummary
    let projectName: String
    let unread: Bool
    let now: Int64
    var family: CardFamily?
    /// A started thread under its lead: no project line, its state beside the title.
    var compact = false
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        // A question in a started thread is the lead's to bring up while they're folded together.
        let asking = family?.started.contains { $0.waiting == true } == true
        let shown = asking ? chat.with(waiting: true) : chat
        let draft = connection.draft(of: chat.id)
        // Only unread news, questions and unsent text stay bright.
        let bright = unread || chat.waiting == true || asking || draft != nil
        Group {
            if compact {
                HStack(spacing: 10) {
                    Text(chat.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(colors.foreground)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    CardState(chat: shown, unread: unread, now: now)
                }
                .frame(minHeight: 44)
            } else {
                HStack(spacing: 12) {
                    StateGlyph(chat: shown, unread: unread, draft: draft != nil).frame(width: 16, height: 16)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(chat.title)
                            .font(.body.weight(.medium))
                            .foregroundStyle(colors.foreground)
                            .lineLimit(1)
                        subline(shown)
                            .font(.footnote)
                            .foregroundStyle(colors.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 4) {
                        CardState(chat: shown, unread: unread, now: now)
                        if let provider = chat.provider {
                            ProviderMark(provider: provider, size: 12).foregroundStyle(colors.faint)
                        }
                    }
                }
                .padding(.vertical, 9)
            }
        }
        .opacity(bright ? 1 : 0.6)
        .draftTint(draft != nil)
        .contentShape(.rect)
    }

    @ViewBuilder
    private func subline(_ shown: RemoteChatSummary) -> some View {
        if let family {
            HStack(spacing: 4) {
                Text("\(projectName) · ")
                Image(systemName: family.open ? "chevron.down" : "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                Text(familyLine(family.started))
            }
            // Its own tap: the rest of the card opens the thread.
            .contentShape(.rect)
            .highPriorityGesture(TapGesture().onEnded(family.fold))
            .accessibilityAddTraits(.isButton)
            .accessibilityHint(family.open ? "Fold the threads it started" : "Show the threads it started")
        } else if let draft = connection.draft(of: shown.id) {
            // A draft's text where the branch would be.
            let before = [projectName, stateLine(shown, now: now)].compactMap { $0 }.joined(separator: " · ")
            Text("\(before) · \(draftText(draft).foregroundStyle(colors.waiting))")
        } else {
            let place = shown.scope == "pr" ? "Pull request" : shown.branch
            Text([projectName, stateLine(shown, now: now), place].compactMap { $0 }.joined(separator: " · "))
        }
    }
}

/// What's going on, for the line under the title; the time column says how long.
private func stateLine(_ chat: RemoteChatSummary, now: Int64) -> String? {
    if inputBlocksThread(chat) { return "needs input" }
    if chat.running == true { return chat.goal?.status == "active" ? "working on its goal" : "working" }
    if wokeUnread(chat, now: now) { return "woke up" }
    if !(chat.pending ?? []).isEmpty { return "waiting on agents" }
    if let next = chat.nextSend { return "sends \(Clock().wakeLabel(next, now: now))" }
    return nil
}

/// The row's leading mark: working, needs you, unread, or nothing new.
private struct StateGlyph: View {
    let chat: RemoteChatSummary
    let unread: Bool
    let draft: Bool
    @Environment(\.colors) private var colors

    var body: some View {
        if inputBlocksThread(chat) {
            Circle().fill(colors.waiting).frame(width: 8, height: 8).accessibilityLabel("Needs you")
        } else if chat.running == true || agentsSince(chat.pending) != nil {
            Spinner(size: 13).accessibilityLabel("Working")
        } else if draft {
            Image(systemName: "pencil").font(.system(size: 13, weight: .medium)).foregroundStyle(colors.waiting)
                .accessibilityLabel("Draft")
        } else if unread {
            Circle().fill(colors.accent).frame(width: 8, height: 8).accessibilityLabel("Unread")
        } else {
            Circle().fill(colors.faint).frame(width: 6, height: 6).accessibilityHidden(true)
        }
    }
}

/// The time column: how long it's been working, else how old it is.
private struct CardState: View {
    let chat: RemoteChatSummary
    let unread: Bool
    let now: Int64
    @Environment(\.colors) private var colors

    var body: some View {
        let since = chat.running == true ? chat.runningSince : agentsSince(chat.pending)
        Group {
            if let since {
                // Ticks by itself, so only this label redraws.
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(elapsedLabel(since, now: Int64(context.date.timeIntervalSince1970 * 1000)))
                        .foregroundStyle(colors.accent)
                }
            } else if chat.nextSend != nil && !unread {
                Image(systemName: "calendar.badge.clock")
                    .foregroundStyle(colors.muted)
                    .accessibilityLabel("Sends later")
            } else {
                Text(shortAge(chat.updated, now: now)).foregroundStyle(unread ? colors.foreground : colors.faint)
            }
        }
        .font(.caption.monospacedDigit())
        .lineLimit(1)
    }
}

/// A compact faded row: a shelf's thread, or a settled lead whose started threads still show.
struct ShelfRow: View {
    let chat: RemoteChatSummary
    let projectName: String
    let label: String
    let actionIcon: String
    let actionLabel: String
    let open: () -> Void
    let action: () -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        // Two buttons of their own styles, so a list row lets each take its own taps.
        HStack(spacing: 4) {
            Button(action: open) {
                HStack(spacing: 10) {
                    ProjectCardBadge(projectId: chat.projectId, name: projectName).opacity(0.65)
                    Text(chat.title).foregroundStyle(colors.muted).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(label).font(.caption).foregroundStyle(colors.muted).lineLimit(1)
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            Button(actionLabel, systemImage: actionIcon, action: action)
                .labelStyle(.iconOnly)
                .font(.system(size: 15))
                .foregroundStyle(colors.muted)
                .frame(width: 36, height: 36)
                .contentShape(.rect)
                .buttonStyle(.borderless)
        }
    }
}

extension RemoteChatSummary {
    fileprivate func with(waiting: Bool) -> RemoteChatSummary {
        var copy = self
        copy.waiting = waiting
        return copy
    }
}
