import RelayRemote
import SwiftUI

// The rows at either end of a thread and between its messages: loading the
// earlier part, where the thread moved, the wait for an answer and picking a
// stopped one back up.

/// At the top of a thread the desktop sent only the latest part of.
struct EarlierMessages: View {
    let chatId: String
    let earlier: Int
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var loading = false

    private var canLoad: Bool { (connection.history[chatId] ?? Bridge.remoteHistory) < Bridge.maxRemoteHistory }

    var body: some View {
        let page = Bridge.remoteHistory
        let label =
            canLoad
            ? "Load \(min(page, earlier)) earlier \(earlier == 1 ? "message" : "messages")\(earlier > page ? " of \(earlier)" : "")"
            : "\(earlier) earlier \(earlier == 1 ? "message is" : "messages are") on your computer"
        Button {
            loading = true
            Task {
                await connection.loadEarlier(chatId)
                loading = false
            }
        } label: {
            HStack(spacing: 6) {
                if loading { ProgressView().controlSize(.mini) }
                Text(label)
            }
            .font(.footnote)
            .foregroundStyle(canLoad ? colors.accent : colors.faint)
            .padding(12)
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!canLoad || loading)
    }
}

/// Where the thread moved under a message, on one line as the desktop's MessageNotes says it.
struct WorkspaceMoveLine: View {
    let moves: [WorkspaceMove]?
    let messageId: String
    @Environment(Connection.self) private var connection

    var body: some View {
        if (connection.overview?.bridge ?? 1) >= Bridge.workspaceMoves, let note = workspaceMoveNote(moves, after: messageId) {
            StatusRow(note)
        }
    }
}

/// Under your newest message (a steer, or a send not picked up yet) while the agent is still at it.
struct AwaitingAnswer: View {
    let provider: String
    let seed: String
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 8) {
            ProviderMark(provider: provider, size: 13)
            ProgressView().controlSize(.mini)
            TimelineView(.periodic(from: .now, by: 6)) { context in
                Text(thinkingWord(seed, now: Int64(context.date.timeIntervalSince1970 * 1000)))
            }
        }
        .font(.footnote)
        .foregroundStyle(colors.muted)
        .padding(.vertical, 4)
    }
}

/// Picks a stopped or failed answer back up, on the composer's settings.
struct ResumeAnswer: View {
    let chatId: String
    let settings: ResumeSettings?
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var busy = false
    @State private var failure: String?
    @State private var switching = false

    var body: some View {
        Button {
            let holder = contextAgent(connection.conversation(chatId))
            if let settings, takesOver(settings.provider, holder: holder) { switching = true } else { resume() }
        } label: {
            Label("Resume answer", systemImage: "arrow.uturn.backward")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(colors.accent)
                .padding(10)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .opacity(busy ? 0.5 : 1)
        .frame(maxWidth: .infinity)
        .alert("Switch to \(agentName(settings?.provider ?? ""))?", isPresented: $switching) {
            Button("Switch to \(agentName(settings?.provider ?? ""))") { resume() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\(agentName(contextAgent(connection.conversation(chatId)) ?? "")) has been working in this thread. The other agent continues from a handoff note and the recent messages.")
        }
        .alert("Couldn't resume", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func resume() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await connection.liveClient().resume(chatId: chatId, settings: settings)
                await connection.load(chatId)
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}

/// The go-ahead for a plan still waiting on it: on the planner, out of Plan mode.
struct ImplementPlan: View {
    let chatId: String
    let rootId: String?
    let planner: String
    @Binding var settings: ResumeSettings?
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var sending = false
    @State private var failure: String?

    var body: some View {
        Button {
            go()
        } label: {
            Text(sending ? "Sending…" : "Implement plan").foregroundStyle(colors.onAccent).frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        .disabled(sending || settings == nil)
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
        .alert("Couldn't send it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func go() {
        guard let current = settings, !sending else { return }
        let (send, next) = planGoAhead(current, planner: planner)
        sending = true
        Task {
            defer { sending = false }
            do {
                try await connection.send(send.body, images: [], to: chatId, with: next, steer: false, rootId: rootId)
                settings = next
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
