import Foundation
import Observation
import RelayRemote

/// What the phone tells you about while it's open, in place of the notifications Android posts
/// from the background: another thread that finished or failed since the last list. One that
/// starts needing you is NeedsYou's banner. Lists from the live link only, so the copy shown at
/// launch doesn't count as news.
@Observable
final class ThreadNotices {
    struct Notice: Identifiable, Equatable {
        let id = UUID()
        let news: ThreadNews
    }

    /// Oldest first; the first is the one showing.
    private(set) var queue: [Notice] = []

    @ObservationIgnored private var before: [String: RemoteChatSummary] = [:]
    @ObservationIgnored private var answers: [String: LastAnswer] = [:]

    static let switchKey = "relay.thread-notices"

    /// Settings' switch; on unless turned off.
    private var on: Bool { UserDefaults.standard.object(forKey: Self.switchKey) as? Bool ?? true }

    /// Another computer's threads aren't news about this one's.
    func reset() {
        before = [:]
        answers = [:]
        queue = []
    }

    func heard(_ chatId: String, _ message: ChatMessage) {
        guard let answer = LastAnswer(message) else { return }
        if let last = answers[chatId], last.created > answer.created { return }
        answers[chatId] = answer
    }

    func listed(_ chats: [RemoteChatSummary]) {
        let was = before
        before = Dictionary(chats.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        // Handled since, here or on the computer: read, answered, or gone.
        queue.removeAll { !stillNews($0.news, before[$0.news.chatId]) }
        guard !was.isEmpty, on else { return }
        for news in threadNews(before: was, now: chats, answers: answers, at: nowMs()) where news.kind != .waiting {
            queue.removeAll { $0.news.chatId == news.chatId }
            queue.append(Notice(news: news))
        }
    }

    func dismiss(_ id: UUID) {
        queue.removeAll { $0.id == id }
    }

    /// The thread is on screen: whatever there was to tell about it, you're looking at it.
    func opened(_ chatId: String) {
        queue.removeAll { $0.news.chatId == chatId }
    }

    private func stillNews(_ news: ThreadNews, _ chat: RemoteChatSummary?) -> Bool {
        guard let chat, !isRead(chat) else { return false }
        return news.kind != .waiting || chat.waiting == true
    }
}
