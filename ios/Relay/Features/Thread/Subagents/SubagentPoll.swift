import RelayRemote
import SwiftUI

// Chat events don't cover the background tasks' frames between turns, so the
// phone asks: conditional reads that send nothing unchanged, every 5s backing
// off to 20s (60s after failures). Only the screen in front asks.

/// A thread's subagents, kept current while its turn runs or any is still out.
@Observable final class Subagents {
    let chatId: String
    private(set) var runs: [SubagentRun] = []
    private(set) var error: String?
    @ObservationIgnored private var signature: String?
    @ObservationIgnored private var asking = false

    init(chatId: String) { self.chatId = chatId }

    var anyOut: Bool { runs.contains(where: \.running) }

    /// True on news, false on none, nil when it failed and `error` says why.
    @discardableResult
    func refresh(_ connection: Connection) async -> Bool? {
        guard !asking else { return false }
        asking = true
        defer { asking = false }
        do {
            let next = try await connection.liveClient().subagents(chatId: chatId, known: signature)
            error = nil
            guard let next else { return false }
            signature = next.signature
            runs = next.runs
            return true
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    /// Stops one; one that finished meanwhile says so rather than failing.
    func stop(_ agentId: String, _ connection: Connection) async throws {
        defer { Task { await refresh(connection) } }
        try await stopAgent(chatId: chatId, agentId: agentId, connection)
    }
}

/// One agent's whole run, kept current while it works.
@Observable final class SubagentRunModel {
    let chatId: String
    let agentId: String
    /// False until the first read answers.
    private(set) var loaded = false
    /// Nil once loaded means the session that ran it is gone.
    private(set) var run: SubagentRun?
    private(set) var error: String?
    @ObservationIgnored private var signature: String?

    init(chatId: String, agentId: String) {
        self.chatId = chatId
        self.agentId = agentId
    }

    @discardableResult
    func refresh(_ connection: Connection) async -> Bool? {
        do {
            let next = try await connection.liveClient().subagentRun(chatId: chatId, agentId: agentId, known: signature)
            error = nil
            guard let next else { return false }
            signature = next.signature
            run = next.run
            loaded = true
            return true
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func stop(_ connection: Connection) async throws {
        defer { Task { await refresh(connection) } }
        try await stopAgent(chatId: chatId, agentId: agentId, connection)
    }
}

private func stopAgent(chatId: String, agentId: String, _ connection: Connection) async throws {
    do {
        try await connection.liveClient().stopAgent(chatId: chatId, agentId: agentId)
    } catch {
        if error.localizedDescription.range(of: "already finished", options: .caseInsensitive) != nil {
            throw PairingError("It finished before Stop reached it.")
        }
        throw error
    }
}

extension Connection {
    var canSeeSubagents: Bool { (overview?.bridge ?? 1) >= Bridge.subagents }
}

extension View {
    /// Reads with `read` while `enabled`, again and again while `again`, as long as the app is in front and online.
    func subagentPoll(enabled: Bool, again: Bool, nudge: String = "", read: @escaping () async -> Bool?) -> some View {
        modifier(SubagentPollModifier(enabled: enabled, again: again, nudge: nudge, read: read))
    }
}

private struct SubagentPollModifier: ViewModifier {
    let enabled: Bool
    let again: Bool
    let nudge: String
    let read: () async -> Bool?
    @Environment(Connection.self) private var connection
    @Environment(\.scenePhase) private var phase

    func body(content: Content) -> some View {
        content.task(id: PollKey(enabled: enabled && connection.canSeeSubagents, online: connection.status.state == .online,
                                 front: phase == .active, again: again, nudge: nudge)) {
            guard enabled, connection.canSeeSubagents, connection.status.state == .online, phase == .active else { return }
            var wait: Int64 = 5_000
            while !Task.isCancelled {
                wait = nextPollDelay(wait, changed: await read())
                guard again else { return }
                try? await Task.sleep(for: .milliseconds(wait))
            }
        }
    }
}

private struct PollKey: Equatable {
    let enabled: Bool
    let online: Bool
    let front: Bool
    let again: Bool
    let nudge: String
}
