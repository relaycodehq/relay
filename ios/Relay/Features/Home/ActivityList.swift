import RelayRemote
import SwiftUI

private let shelfPage = 5
private let snoozeColor = Color(red: 0xD9 / 255, green: 0x9A / 255, blue: 0x2B / 255)

/// The desktop sidebar's Activity view (Android's ActivityList.kt): one card per open thread,
/// the ones that need nothing from you faded back, and Snoozed and Settled folded away below.
/// Swipe right settles, left snoozes; holding one brings up the rest.
struct ActivityList: View {
    let open: (String) -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @Environment(\.threadFilter) private var filter
    @AppStorage("relay.family-folds") private var foldsData = Data()
    @State private var shelves = ["snoozed": 0, "settled": 0]
    @State private var toast: ToastItem?
    @State private var failure: String?

    var body: some View {
        // Ages and "sends" labels move with the clock.
        TimelineView(.periodic(from: .now, by: 30)) { context in
            list(now: Int64(context.date.timeIntervalSince1970 * 1000))
        }
        .toast($toast)
        .alert("Couldn't change it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") {}
        } message: {
            Text(failure ?? "")
        }
    }

    private var folds: FamilyFolds { (try? JSONDecoder().decode(FamilyFolds.self, from: foldsData)) ?? FamilyFolds() }

    private func list(now: Int64) -> some View {
        let filter = connection.current(filter)
        let sections = chatActivitySections(connection.chats.filter(filter.keeps), now: now)
        let families = startedFamilies(sections.active, settled: sections.settled)
        let folds = folds
        return List {
            ForEach(groupByState(families.top, started: families.started), id: \.label) { group in
                if !group.chats.isEmpty {
                    Section {
                        ForEach(group.chats) { chat in family(chat, families, folds, now) }
                    } header: {
                        SectionLabel(title: group.label, count: group.chats.count)
                    }
                }
            }
            if sections.active.isEmpty { InboxZero(filtered: filter.count > 0).activityRow() }
            shelf("snoozed", "Snoozed", sections.snoozed, now)
            shelf("settled", "Settled", sections.settled.filter { !families.headers.contains($0.id) }, now)
        }
        .listStyle(.plain)
        .ribbonRefresh { await connection.reloadList() }
    }

    private func name(_ chat: RemoteChatSummary) -> String { connection.project(chat.projectId)?.name ?? "?" }

    @ViewBuilder
    private func family(_ chat: RemoteChatSummary, _ families: StartedFamilies, _ folds: FamilyFolds, _ now: Int64)
        -> some View
    {
        let started = families.started[chat.id] ?? []
        if families.headers.contains(chat.id) {
            ShelfRow(
                chat: chat, projectName: name(chat), label: "Settled", actionIcon: "arrow.counterclockwise",
                actionLabel: "Move back to activity", open: { open(chat.id) }, action: { triage(chat, .unsettle) }
            )
            .activityRow()
            ForEach(started) { card($0, now, compact: true) }
        } else {
            // A family's fold as the user left it; until then open while any of it needs a look.
            let isOpen = !started.isEmpty && (folds[chat.id] ?? !familySettled(started, unread: connection.unread))
            card(chat, now, family: started.isEmpty ? nil : CardFamily(started: started, open: isOpen) { fold(chat.id, !isOpen) })
            if isOpen { ForEach(started) { card($0, now, compact: true) } }
        }
    }

    private func card(_ chat: RemoteChatSummary, _ now: Int64, family: CardFamily? = nil, compact: Bool = false)
        -> some View
    {
        Button { open(chat.id) } label: {
            ActivityCard(
                chat: chat, projectName: name(chat), unread: connection.unread(chat), now: now, family: family,
                compact: compact)
        }
        .activityRow(indent: compact ? 28 : 0)
        // The hairline down the left of a family's started threads.
        .overlay(alignment: .leading) {
            if compact { Rectangle().fill(colors.border).frame(width: 1).offset(x: -6) }
        }
        // The same guards as the hold menu: nothing settles while working or asking.
        .swipeActions(edge: .leading) {
            if settles(chat) {
                Button("Settle", systemImage: "checkmark") { swiped(chat, .settle, done: "Settled") }
                    .tint(colors.accent)
            }
        }
        .swipeActions(edge: .trailing) {
            Button("Snooze", systemImage: "moon.zzz") {
                // Taken now: `now` only ticks every half minute.
                let at = nowMs()
                let until = Clock().snoozePresets(at)[0].until
                swiped(chat, .snooze(until: until), done: "Snoozed until \(Clock().wakeLabel(until, now: at))")
            }
            .tint(snoozeColor)
        }
        .contextMenu { holdMenu(chat, now) }
    }

    private func settles(_ chat: RemoteChatSummary) -> Bool { chat.running != true && chat.waiting != true }

    /// A held card's menu: settle, snooze until, mark unread, copy its branch.
    @ViewBuilder
    private func holdMenu(_ chat: RemoteChatSummary, _ now: Int64) -> some View {
        if settles(chat) {
            Button { triage(chat, .settle) } label: {
                Label("Settle", systemImage: "checkmark")
                Text("Hide it until something new happens")
            }
        }
        Menu {
            ForEach(Clock().snoozePresets(now), id: \.id) { preset in
                Button { triage(chat, .snooze(until: preset.until)) } label: {
                    Text(preset.label)
                    Text(Clock().wakeLabel(preset.until, now: now))
                }
            }
        } label: {
            Label("Snooze", systemImage: "moon.zzz")
        }
        if connection.canMarkUnread {
            Button("Mark as Unread", systemImage: "envelope.badge") { triage(chat, .unread) }
        }
        if let branch = chat.branch {
            Button { UIPasteboard.general.string = branch } label: {
                Label("Copy Branch Name", systemImage: "doc.on.doc")
                Text(branch)
            }
        }
    }

    @ViewBuilder
    private func shelf(_ kind: String, _ label: String, _ items: [RemoteChatSummary], _ now: Int64) -> some View {
        if !items.isEmpty {
            let shown = shelves[kind] ?? 0
            Section {
                ForEach(items.prefix(shown)) { chat in
                    let snoozed = kind == "snoozed"
                    ShelfRow(
                        chat: chat, projectName: name(chat),
                        label: snoozed
                            ? Clock().wakeLabel(chat.snoozedUntil ?? now, now: now) : shortAge(chat.updated, now: now),
                        actionIcon: snoozed ? "sunrise" : "arrow.counterclockwise",
                        actionLabel: snoozed ? "Wake now" : "Move back to activity",
                        open: { open(chat.id) },
                        action: { triage(chat, snoozed ? .wake : .unsettle) }
                    )
                    .activityRow()
                }
                if items.count > shown && shown > 0 {
                    Button("Show \(min(shelfPage, items.count - shown)) more") { shelves[kind] = shown + shelfPage }
                        .foregroundStyle(colors.muted)
                        .frame(minHeight: 44)
                        .activityRow()
                }
            } header: {
                // A group label like the ones above, that folds its rows away.
                Button { shelves[kind] = shown > 0 ? 0 : shelfPage } label: {
                    SectionLabel(title: label, count: items.count, folded: shown == 0)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(shown > 0 ? "Fold \(label)" : "Show \(label)")
            }
        }
    }

    private func fold(_ lead: String, _ open: Bool) {
        var next = folds
        next.fold(lead, open: open)
        if let data = try? JSONEncoder().encode(next) { foldsData = data }
    }

    private func triage(_ chat: RemoteChatSummary, _ action: TriageAction) {
        Task {
            do { try await connection.triage(chat.id, action) } catch { failure = error.localizedDescription }
        }
    }

    /// A swipe's triage, with an Undo that puts back what it changed.
    private func swiped(_ chat: RemoteChatSummary, _ action: TriageAction, done: String) {
        Task {
            do {
                let after = try await connection.triage(chat.id, action)
                toast = ToastItem(title: done, detail: chat.title, actionLabel: "Undo") {
                    triage(chat, undoTriage(chat, after: after))
                }
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}

struct SectionLabel: View {
    let title: String
    let count: Int
    /// A shelf's fold, when it has one.
    var folded: Bool?
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 6) {
            Text(title).fontWeight(.medium).foregroundStyle(colors.muted)
            Spacer()
            Text("\(count)").foregroundStyle(colors.faint)
            if let folded {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(colors.faint)
                    .rotationEffect(.degrees(folded ? 0 : 90))
            }
        }
        .font(.caption)
        .textCase(nil)
        .contentShape(.rect)
    }
}

private struct InboxZero: View {
    /// Under a filter, nothing here says nothing about the rest.
    let filtered: Bool
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(spacing: 6) {
            Circle()
                .fill(colors.accentSoft)
                .frame(width: 36, height: 36)
                .overlay {
                    Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(colors.accent)
                }
                .padding(.bottom, 4)
            Text(filtered ? "Nothing open here" : "Inbox zero").font(.body.weight(.semibold))
                .foregroundStyle(colors.foreground)
            Text(
                filtered
                    ? "No open thread matches the filter."
                    : "Threads come back here when an agent replies or needs you.")
                .font(.subheadline)
                .foregroundStyle(colors.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 26)
        .padding(.horizontal, 18)
    }
}

extension View {
    /// Android's and the desktop's lists: plain rows under a quiet label, no cards or rules.
    func activityRow(indent: CGFloat = 0) -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: 20 + indent, bottom: 0, trailing: 20))
    }
}
