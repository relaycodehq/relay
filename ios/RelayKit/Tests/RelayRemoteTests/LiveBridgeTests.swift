import Foundation
import Testing
@testable import RelayRemote

/// Pairs with a real desktop bridge (ios/scripts/live-desktop.ts), then signs in
/// again with the saved credentials. Runs only with RELAY_PAIR_URL_FILE set;
/// never point it at a desktop you use, pairing adds a device there.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["RELAY_PAIR_URL_FILE"] != nil))
struct LiveBridgeTests {
    @Test(.timeLimit(.minutes(1)))
    func pairCallHearEventsAndSignInAgain() async throws {
        let file = ProcessInfo.processInfo.environment["RELAY_PAIR_URL_FILE"]!
        let link = try #require(parsePairingURL(String(contentsOfFile: file, encoding: .utf8)))

        let first = RemoteClient(.pair(link, device: "Swift smoke"))
        var updates = first.updates.makeAsyncIterator()
        await first.start()
        var credentials: RemoteCredentials?
        var online = false
        while !online || credentials == nil, let update = await updates.next() {
            switch update {
            case .paired(let c): credentials = c
            case .status(let s):
                online = s.state == .online
                #expect(s.state != .denied && s.state != .offline, "\(s)")
            default: break
            }
        }
        #expect(await first.bridge == Bridge.version)
        let overview = try await first.overview()
        #expect(overview.projects.map(\.name) == ["Relay"])
        let chatId = try #require(overview.chats.first?.id)
        #expect(try await first.chat(chatId).messages.isEmpty)
        var heard: [RemoteChatSummary]?
        while heard == nil, let update = await updates.next() {
            if case .event(.chats(let chats)) = update { heard = chats }
        }
        #expect(heard?.first?.title.hasPrefix("Fix the flaky test ") == true)
        await first.close()

        let again = RemoteClient(.saved(try #require(credentials)))
        var more = again.updates.makeAsyncIterator()
        await again.start()
        while let update = await more.next() {
            if case .status(let s) = update, s.state == .online { break }
        }
        #expect(try await again.overview().chats.first?.id == chatId)
        await again.close()
    }
}
