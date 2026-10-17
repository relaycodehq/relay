import RelayRemote
import SwiftUI
import UIKit

extension View {
    /// The thread's own actions in the toolbar (Android's threadMenu): rename, done, snooze,
    /// unread, a fresh title, its branch, side conversations, compact and archive.
    func threadMenu(chatId: String, shown: Bool, leavingUnread: Binding<Bool>) -> some View {
        modifier(ThreadMenu(chatId: chatId, shown: shown, leavingUnread: leavingUnread))
    }
}

private struct ThreadMenu: ViewModifier {
    let chatId: String
    let shown: Bool
    @Binding var leavingUnread: Bool
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.dismiss) private var dismiss
    @State private var renaming = false
    @State private var name = ""
    @State private var archiving = false
    @State private var failure: (title: String, message: String)?

    private var thread: RemoteChat? { connection.threads[chatId] }
    private var summary: RemoteChatSummary? { connection.chats.first { $0.id == chatId } }

    func body(content: Content) -> some View {
        content
            .toolbar {
                if shown {
                    ToolbarItem(placement: .primaryAction) {
                        Menu("Thread actions", systemImage: "ellipsis") { items }
                            .disabled(thread == nil)
                    }
                }
            }
            .alert("Rename thread", isPresented: $renaming) {
                TextField("Thread name", text: $name)
                Button("Cancel", role: .cancel) {}
                Button("Save") { rename() }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .confirmationDialog("Archive this thread?", isPresented: $archiving, titleVisibility: .visible) {
                Button("Archive", role: .destructive) { archive() }
            } message: {
                Text("It leaves your lists; the desktop keeps it.")
            }
            .alert(
                failure?.title ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
            ) {
                Button("OK") {}
            } message: {
                Text(failure?.message ?? "")
            }
    }

    @ViewBuilder
    private var items: some View {
        let now = nowMs()
        let running = summary?.running == true
        let settled = summary.map(chatSettled) ?? false
        let snoozed = summary.map { chatSnoozed($0, now: now) } ?? false
        let messages = thread?.messages ?? []
        let counts = replyCounts(messages)
        // Side conversations: `/btw` questions and messages someone replied to.
        let sides = messages.filter { $0.parentId == nil && ($0.side == true || counts[$0.id] != nil) }
        Section {
            Button("Rename", systemImage: "pencil") {
                name = thread?.title ?? summary?.title ?? ""
                renaming = true
            }
            if settled {
                Button("Move Back to Active", systemImage: "arrow.counterclockwise") {
                    act("Couldn't move it") { try await connection.triage(chatId, .unsettle) }
                }
            } else if running {
                Button("Mark as Done When It Ends", systemImage: "checkmark.circle") {
                    act("Couldn't mark it done") { try await connection.triage(chatId, .settleWhenDone) }
                }
            } else {
                Button("Mark as Done", systemImage: "checkmark.circle") {
                    act("Couldn't mark it done") { try await connection.triage(chatId, .settle) }
                }
            }
            if snoozed {
                Button("Wake Up Now", systemImage: "sunrise") {
                    act("Couldn't wake it") { try await connection.triage(chatId, .wake) }
                }
            } else {
                Menu {
                    ForEach(Clock().snoozePresets(now), id: \.id) { preset in
                        Button {
                            act("Couldn't snooze it") { try await connection.triage(chatId, .snooze(until: preset.until)) }
                        } label: {
                            Text(preset.label)
                            Text(Clock().wakeLabel(preset.until, now: now))
                        }
                    }
                } label: {
                    Label("Snooze", systemImage: "moon.zzz")
                }
            }
            if connection.canMarkUnread {
                Button { markUnread() } label: {
                    Label("Mark as Unread", systemImage: "envelope.badge")
                    Text("Back to the list, marked for later")
                }
            }
            if connection.canRegenerateTitle {
                Button {
                    act("Couldn't name it") { try await connection.regenerateTitle(chatId) }
                } label: {
                    Label("Regenerate Title", systemImage: "sparkles")
                    Text("A fresh name from the conversation so far")
                }
            }
        }
        Section {
            if let branch = thread?.worktree?.branch ?? summary?.branch {
                copy("Copy Branch Name", branch)
            }
            if let path = thread?.worktree?.path {
                copy("Copy Worktree Path", path)
            }
            if !sides.isEmpty {
                Menu {
                    ForEach(sides) { m in
                        let n = counts[m.id] ?? 0
                        let what = m.side == true ? "Asked beside the conversation" : m.role == "user" ? "Your message" : "An answer"
                        Button { navigate(.replies(chatId: chatId, rootId: m.id)) } label: {
                            let title = preview(withoutAgentMention(m.body), length: 80)
                            Text(title.isEmpty ? "Side conversation" : title)
                            Text("\(what) · \(n) \(n == 1 ? "reply" : "replies")")
                        }
                    }
                } label: {
                    Label("Side Conversations", systemImage: "bubble.left.and.bubble.right")
                    Text("\(sides.count) beside this one")
                }
            }
            if let thread {
                Button("Files", systemImage: "doc.text") { navigate(.files(place: thread.bridgeWhere)) }
                GitMenuItems(thread: thread)
            }
            if connection.canTunnel {
                Button { navigate(.browser()) } label: {
                    Label("Sites", systemImage: "globe")
                    Text("What runs on the computer's localhost, in a browser here")
                }
            }
            Button {
                act("Couldn't compact it") { try await connection.compact(chatId) }
            } label: {
                Label("Compact the Conversation", systemImage: "arrow.down.right.and.arrow.up.left")
                Text("The agent summarises it to free up its context.")
            }
        }
        Section {
            Button("Archive", systemImage: "archivebox", role: .destructive) { archiving = true }
        }
    }

    private func copy(_ title: String, _ value: String) -> some View {
        Button { UIPasteboard.general.string = value } label: {
            Label(title, systemImage: "doc.on.doc")
            Text(value)
        }
    }

    private func act(_ failed: String, _ job: @escaping () async throws -> Void) {
        Task {
            do { try await job() } catch { failure = (failed, error.localizedDescription) }
        }
    }

    private func rename() {
        let next = name.trimmingCharacters(in: .whitespaces)
        guard !next.isEmpty, next != thread?.title else { return }
        act("Couldn't rename it") { try await connection.rename(chatId, to: next) }
    }

    /// Marks it unread and leaves the thread; holding off the seen mark meanwhile keeps it.
    private func markUnread() {
        leavingUnread = true
        Task {
            do {
                try await connection.triage(chatId, .unread)
                dismiss()
            } catch {
                leavingUnread = false
                failure = ("Couldn't mark it", error.localizedDescription)
            }
        }
    }

    private func archive() {
        Task {
            do {
                try await connection.triage(chatId, .archive)
                dismiss()
            } catch {
                failure = ("Couldn't archive it", error.localizedDescription)
            }
        }
    }
}
