import RelayRemote
import SwiftUI

/// The second opinions this phone asks and sends back (Android's
/// SecondOpinions), for the cards under the answers they check.
@MainActor @Observable final class SecondOpinions {
    static let shared = SecondOpinions()

    struct Ask: Equatable {
        var provider: String
        var error: String?
    }

    /// By "chat:answer"; gone once its thread is listed.
    private(set) var asks: [String: Ask] = [:]
    /// By the opinion's thread.
    private(set) var sendErrors: [String: String] = [:]
    private(set) var sending: Set<String> = []
    /// Sent from here, before the lead's messages say so.
    private(set) var sentHere: Set<String> = []

    func ask(_ chatId: String, _ answerId: String) -> Ask? { asks["\(chatId):\(answerId)"] }

    func ask(_ chatId: String, _ answerId: String, provider: String, model: String, _ connection: Connection) {
        let key = "\(chatId):\(answerId)"
        asks[key] = Ask(provider: provider)
        Task {
            do {
                try await connection.liveClient().askSecondOpinion(
                    chatId: chatId, answerId: answerId, provider: provider, model: model)
                asks[key] = nil
            } catch {
                asks[key] = Ask(provider: provider, error: error.localizedDescription)
            }
        }
    }

    func sendBack(_ opinionId: String, _ connection: Connection) {
        sending.insert(opinionId)
        sendErrors[opinionId] = nil
        Task {
            defer { sending.remove(opinionId) }
            do {
                try await connection.liveClient().sendSecondOpinion(opinionId)
                sentHere.insert(opinionId)
            } catch {
                sendErrors[opinionId] = error.localizedDescription
            }
        }
    }
}
