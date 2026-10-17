import Foundation

/// Saves the latest threads for reading offline before they're opened
/// (mobile/src/remote/offline-copies.ts, Android's ReadAhead.kt), so a train
/// or a sleeping computer leaves more than the threads read on the phone.
public actor ReadAhead {
    public struct Wanted: Sendable, Equatable {
        public var computer: String
        public var id: String
        public var updated: Int64

        public init(computer: String, id: String, updated: Int64) {
            self.computer = computer
            self.id = id
            self.updated = updated
        }

        var key: String { "\(computer):\(id)" }
    }

    /// Fewer than `ThreadCache` keeps, so threads read on the phone stay too.
    public static let ahead = 8
    /// Quiet time after the list moves, so a burst of changes costs one pass.
    public static let settle: Duration = .seconds(3)

    private let cache: ThreadCache
    private let settle: Duration
    private let fetch: @Sendable (_ id: String, _ saved: RemoteChat?) async throws -> RemoteChat
    /// Thread → the summary's `updated` it was saved at, this run.
    private var copied: [String: Int64] = [:]
    private var last: [Wanted] = []
    private var pass: Task<Void, Never>?

    public init(
        cache: ThreadCache, settle: Duration = ReadAhead.settle,
        fetch: @escaping @Sendable (_ id: String, _ saved: RemoteChat?) async throws -> RemoteChat
    ) {
        self.cache = cache
        self.settle = settle
        self.fetch = fetch
    }

    /// The newest threads that aren't running, as the thread list has them.
    public static func wanted(_ chats: [RemoteChatSummary], computer: String) -> [Wanted] {
        // A running one changes by the second; it's saved once it stops.
        chats.sorted { $0.updated > $1.updated }.prefix(ahead).filter { $0.running != true }
            .map { Wanted(computer: computer, id: $0.id, updated: $0.updated) }
    }

    /// The threads to keep copies of now; empty while there's no link. A new list replaces a pass still waiting.
    public func want(_ all: [Wanted]) {
        guard all != last else { return }
        last = all
        pass?.cancel()
        let due = all.filter { (copied[$0.key] ?? 0) < $0.updated }
        guard !due.isEmpty else { return }
        pass = Task { [settle] in
            try? await Task.sleep(for: settle)
            for thread in due {
                guard !Task.isCancelled, await copy(thread) else { return }
            }
        }
    }

    /// Waits for the pass under way, for tests.
    func settled() async { await pass?.value }

    /// False when the link or the thread is gone; the next change to the list tries again.
    private func copy(_ thread: Wanted) async -> Bool {
        if cache.stale(thread.computer, thread.id, updated: thread.updated) {
            // Only what changed travels: the saved copy's messages go as known.
            let saved = cache.now(thread.computer, thread.id)
            do {
                let fresh: RemoteChat
                do { fresh = try await fetch(thread.id, saved) } catch is MissingMessage { fresh = try await fetch(thread.id, nil) }
                cache.save(thread.computer, thread.id, fresh)
            } catch {
                return false
            }
        }
        copied[thread.key] = thread.updated
        return true
    }
}
