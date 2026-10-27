import RelayRemote
import SwiftUI

/// What docks over a thread's composer, as on the desktop and Android: the
/// goal, a usage limit and work that stopped; the subagents and started
/// threads at work; background work waiting; a settled thread's note. Last of
/// them, one that asks for something comes first.
struct ThreadDock: View {
    let chatId: String
    let thread: RemoteChat?
    let summary: RemoteChatSummary?
    let running: Bool
    @Environment(Connection.self) private var connection
    @State private var agents: Subagents
    @State private var listing = false
    @State private var listedStarted: [RemoteChatSummary] = []

    init(chatId: String, thread: RemoteChat?, summary: RemoteChatSummary?, running: Bool) {
        self.chatId = chatId
        self.thread = thread
        self.summary = summary
        self.running = running
        _agents = State(initialValue: Subagents(chatId: chatId))
    }

    var body: some View {
        // The pushed summary's copy, which a turn's ending doesn't wait for.
        let pending = summary?.pending ?? thread?.pending ?? []
        let out = pending.count(where: { $0.kind == "task" && $0.agent == true })
        let batch = runningBatch(agents.runs, now: nowMs())
        let family = startedOf(chatId, connection.chats)
        let started = familyInDock(family) ? family : []
        let waiting = outsideBatch(pending, batch)
        let stopped = thread?.stopped?.items ?? []
        let limit = running ? nil : summary?.limitResume
        let pressing = (!waiting.isEmpty && !running) || limit != nil || !stopped.isEmpty
        VStack(spacing: 0) {
            if let goal = summary?.goal { GoalStrip(goal: goal, running: running) }
            if let limit { LimitStrip(chatId: chatId, plan: limit) }
            if !stopped.isEmpty { StoppedStrip(chatId: chatId, items: stopped) }
            SubagentStrip(agents: agents, batch: batch, started: started, root: thread?.root) {
                listedStarted = started
                listing = true
            }
            if !waiting.isEmpty && !running { WaitingStrip(chatId: chatId, pending: waiting) }
            if let summary, chatSettled(summary), !pressing {
                SettledStrip(chatId: chatId, whenDone: summary.settleWhenDone != nil)
            }
        }
        .animation(.snappy(duration: 0.2), value: [summary?.goal != nil, limit != nil, !stopped.isEmpty, !waiting.isEmpty])
        // Look again as a turn starts and ends, even when it finishes between reads.
        .subagentPoll(enabled: true, again: running || out > 0 || agents.anyOut, nudge: "\(running):\(out)") {
            await agents.refresh(connection)
        }
        .sheet(isPresented: $listing) {
            // The started threads too when the strip told of them as it opened, kept current.
            SubagentsSheet(agents: agents, opened: batch, started: listedStarted.isEmpty ? [] : family, root: thread?.root)
                .presentationDetents([.medium, .large])
        }
    }
}
