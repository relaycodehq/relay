import Foundation
import Testing

@testable import RelayRemote

// The Android app's LiveTunnelSmokeTest: the phone's tunnel against a real
// desktop bridge (ios/scripts/live-desktop.ts), whose first project runs a
// stand-in dev server. Runs only with RELAY_TUNNEL_PAIR_URL_FILE set, to a
// stand-in of its own: a pairing link works once, so it can't share the live
// bridge test's.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["RELAY_TUNNEL_PAIR_URL_FILE"] != nil))
struct LiveTunnelTests {
    func get(_ url: String) async throws -> (Data, Int) {
        let (body, response) = try await URLSession.shared.data(from: try #require(URL(string: url)))
        return (body, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    @Test(.timeLimit(.minutes(1)))
    func pagesAndABigDownloadComeThroughTheBridge() async throws {
        let file = ProcessInfo.processInfo.environment["RELAY_TUNNEL_PAIR_URL_FILE"]!
        let link = try #require(parsePairingURL(String(contentsOfFile: file, encoding: .utf8)))
        let client = RemoteClient(.pair(link, device: "Swift tunnel smoke"))
        await client.start()
        for await update in client.updates {
            guard case .status(let s) = update else { continue }
            #expect(s.state != .denied && s.state != .offline, "\(s)")
            if s.state == .online || s.state == .denied || s.state == .offline { break }
        }
        #expect(await client.supports(Bridge.tunnel))
        let sites = try await client.sites()
        let site = try #require(sites.first)
        #expect(sites.count == 1 && site.title == "Dev server" && site.command == "npm run dev")

        let listeners = TunnelListeners()
        listeners.streams = client.tunnel
        let release = listeners.hold()
        // The stand-in's server holds the port on this computer, so the phone takes another.
        let local = try await listeners.listen(site.port)
        #expect(local != site.port)
        let url = try await listeners.local(SiteAddress(port: site.port))
        #expect(url == "http://127.0.0.1:\(local)/")

        let (page, status) = try await get(url)
        let html = String(decoding: page, as: UTF8.self)
        #expect(status == 200)
        #expect(html.contains("<title>Stand-in dev server</title>"))
        #expect(html.contains("Asked for as <code>127.0.0.1:\(local)</code>"))
        let (about, _) = try await get("http://127.0.0.1:\(local)/about")
        #expect(String(decoding: about, as: UTF8.self).contains("<h1>Another page</h1>"))
        let (big, _) = try await get("http://127.0.0.1:\(local)/big")
        #expect(big.count == 5 * 1024 * 1024)
        #expect(stride(from: 0, to: big.count, by: 4099).allSatisfy { big[$0] == UInt8((($0 * 31) + ($0 >> 11)) & 255) })

        // New connections are turned away once no browser holds the listeners.
        release()
        #expect(try await Browser(port: local).page().hasPrefix("HTTP/1.1 403 "))
        await client.close()
    }
}
