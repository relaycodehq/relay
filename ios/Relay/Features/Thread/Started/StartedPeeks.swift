import RelayRemote
import SwiftUI

/// What the phone holds of each thread a lead started, for the lead's rows
/// (mobile/src/remote/started-peeks.ts): its latest answer and what it asks.
/// From the offline copy first, then fetched whenever it starts, stops, asks
/// or moves on, one fetch per thread at a time.
@Observable final class StartedPeeks {
    static let shared = StartedPeeks()

    private var peeks: [String: StartedPeek] = [:]
    /// The started thread's state its peek was last fetched at.
    @ObservationIgnored private var fetchedAt: [String: String] = [:]
    @ObservationIgnored private var fetching: Set<String> = []
    @ObservationIgnored private var wanted: [String: String] = [:]

    func peek(_ computer: String?, _ id: String) -> StartedPeek { peeks["\(computer ?? ""):\(id)"] ?? StartedPeek() }

    /// Brings each row's peek up to its thread's state.
    func follow(_ started: [RemoteChatSummary], _ connection: Connection) {
        guard let computer = connection.active else { return }
        let online = connection.status.state == .online
        // A thread can answer again while the link is down and still read idle.
        if !online { fetchedAt = [:] }
        for chat in started {
            let key = "\(computer):\(chat.id)"
            let state = "\(chat.running == true):\(chat.waiting == true):\(chat.updated)"
            if peeks[key] == nil, let saved = connection.offline.now(computer, chat.id) { peeks[key] = StartedPeek(saved) }
            guard online else { continue }
            wanted[key] = state
            guard fetchedAt[key] != state, !fetching.contains(key), let client = try? connection.liveClient() else { continue }
            fetching.insert(key)
            Task { await fetch(chat.id, key: key, state: state, computer: computer, client: client, connection) }
        }
    }

    private func fetch(_ id: String, key: String, state: String, computer: String, client: RemoteClient, _ connection: Connection) async {
        defer { fetching.remove(key) }
        var state = state
        while true {
            do {
                let saved = connection.offline.now(computer, id)
                let thread: RemoteChat
                do { thread = try await client.chat(id, previous: saved) } catch is MissingMessage { thread = try await client.chat(id) }
                connection.offline.save(computer, id, thread)
                peeks[key] = StartedPeek(thread)
                fetchedAt[key] = state
            } catch {
                // Lost the link or the thread: the next change or visit asks again.
                return
            }
            // Changes during a read need one more read; they won't restart the view's task again.
            guard let next = wanted[key], next != state,
                connection.active == computer, (try? connection.liveClient()) === client,
                connection.status.state == .online
            else { return }
            state = next
        }
    }
}
