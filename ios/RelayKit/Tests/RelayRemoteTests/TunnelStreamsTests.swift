import Foundation
import Network
import Testing

@testable import RelayRemote

// The Android app's TunnelStreamsTest: the phone's streams over real loopback
// connections, with the test playing the desktop.
@Suite(.timeLimit(.minutes(1)))
struct TunnelStreamsTests {
    /// The client's queue.
    let queue = DispatchQueue(label: "test.client")
    /// What the phone sent the desktop.
    let sent = Inbox<TunnelFrame>()

    func streams(window: Int = 64 * 1024, openTimeout: DispatchTimeInterval = .seconds(15), ready: Bool = true)
        -> TunnelStreams
    {
        let streams = TunnelStreams(queue: queue, name: "Mac", window: window, openTimeout: openTimeout)
        if ready { queue.sync { streams.connect { [sent] in sent.put($0) } } }
        return streams
    }

    /// A browser's connection to `port` on the desktop, as a listener hands it over; the test holds the browser's end.
    func browse(_ streams: TunnelStreams, port: Int = 5177) async throws -> Browser {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let listener = try NWListener(using: parameters)
        let bound = Inbox<Int>()
        let accepted = Inbox<NWConnection>()
        listener.stateUpdateHandler = { [weak listener] state in
            if case .ready = state, let port = listener?.port { bound.put(Int(port.rawValue)) }
        }
        listener.newConnectionHandler = { accepted.put($0) }
        listener.start(queue: DispatchQueue(label: "test.listener"))
        defer { listener.cancel() }
        let browser = Browser(port: try #require(await bound.next()))
        streams.accept(try #require(await accepted.next()), port: port)
        return browser
    }

    func desktop(_ streams: TunnelStreams, _ frames: TunnelFrame...) {
        queue.async { frames.forEach(streams.receive) }
    }

    func next() async throws -> TunnelFrame {
        try #require(await sent.next(), "The phone sent nothing.")
    }

    func nextData() async throws -> Data {
        let frame = try await next()
        guard case .data(_, let bytes, false) = frame else { throw Unexpected(frame: frame) }
        return bytes
    }

    func nextCredit() async throws -> Int {
        let frame = try await next()
        guard case .credit(_, let bytes) = frame else { throw Unexpected(frame: frame) }
        return bytes
    }

    struct Unexpected: Error {
        let frame: TunnelFrame
    }

    func awaitActive(_ streams: TunnelStreams, _ n: Int) async throws {
        for _ in 0..<200 {
            if queue.sync(execute: { streams.active }) == n { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        Issue.record("Streams didn't go to \(n).")
    }

    @Test func carriesBytesBothWaysAndEndsLikeTCP() async throws {
        let streams = streams()
        let browser = try await browse(streams)
        #expect(try await next() == .open(stream: 1, port: 5177))
        desktop(streams, .opened(stream: 1))
        try await browser.write("GET /")
        #expect(String(decoding: try await nextData(), as: UTF8.self) == "GET /")
        desktop(streams, .data(stream: 1, bytes: Data("HTTP/1.1 200 OK".utf8)), .end(stream: 1))
        #expect(String(decoding: await browser.readExactly(15), as: UTF8.self) == "HTTP/1.1 200 OK")
        #expect(await browser.read() == nil)
        browser.shutdownOutput()
        #expect(try await next() == .end(stream: 1))
        desktop(streams, .close(stream: 1, reason: ""))
        try await awaitActive(streams, 0)
    }

    @Test func showsTheDesktopsRefusalAsAPageInsteadOfHanging() async throws {
        let streams = streams()
        let browser = try await browse(streams)
        _ = try await next()
        desktop(streams, .close(stream: 1, reason: "Nothing is listening on port 5177."))
        let page = try await browser.page()
        #expect(page.hasPrefix("HTTP/1.1 502 "), "\(page)")
        #expect(page.contains("Mac didn't open localhost:5177"))
        #expect(page.contains("Nothing is listening on port 5177."))
    }

    @Test func saysSoWhenTheLinkIsDownWithoutAskingTheDesktop() async throws {
        let streams = streams(ready: false)
        let page = try await browse(streams).page()
        #expect(page.hasPrefix("HTTP/1.1 503 "), "\(page)")
        #expect(page.contains("Not connected to Mac"))
        #expect(await sent.next(within: .milliseconds(200)) == nil)
    }

    @Test func sendsTheBrowsersBytesOnlyAsFarAsTheDesktopsCreditGoes() async throws {
        let window = 64 * 1024
        let streams = streams(window: window)
        let browser = try await browse(streams)
        _ = try await next()
        desktop(streams, .opened(stream: 1))
        let body = Data((0..<200 * 1024).map { UInt8($0 % 251) })
        Task { try? await browser.write(body) }
        var got = Data()
        var credited = window
        while got.count < body.count {
            while got.count < min(credited, body.count) { got.append(try await nextData()) }
            #expect(got.count == min(credited, body.count))
            // Nothing more until the desktop credits it.
            if got.count < body.count { #expect(await sent.next(within: .milliseconds(150)) == nil) }
            desktop(streams, .credit(stream: 1, bytes: window))
            credited += window
        }
        #expect(got == body)
    }

    @Test func creditsTheDesktopsBytesBackOnceTheBrowserTookThem() async throws {
        let window = 64 * 1024
        let streams = streams(window: window)
        let browser = try await browse(streams)
        _ = try await next()
        let half = Data(repeating: 1, count: window / 2)
        desktop(streams, .opened(stream: 1), .data(stream: 1, bytes: half), .data(stream: 1, bytes: half))
        #expect(await browser.readExactly(window).count == window)
        var credit = 0
        while credit < window { credit += try await nextCredit() }
        #expect(credit == window)
    }

    // Not in the Android test: the desktop packs chunks that shrink.
    @Test func unpacksWhatTheDesktopDeflated() async throws {
        let streams = streams()
        let browser = try await browse(streams)
        _ = try await next()
        let page = Data(String(repeating: "<p>hello from the desktop</p>\n", count: 200).utf8)
        let packed = try Codec.deflate(page)
        desktop(streams, .opened(stream: 1), .data(stream: 1, bytes: packed, packed: true))
        #expect(await browser.readExactly(page.count) == page)
    }

    @Test func dropsAStreamTheDesktopSendsPastTheWindow() async throws {
        let window = 64 * 1024
        let streams = streams(window: window)
        let browser = try await browse(streams)
        _ = try await next()
        let chunk = Data(count: window / 2)
        desktop(
            streams, .opened(stream: 1), .data(stream: 1, bytes: chunk), .data(stream: 1, bytes: chunk),
            .data(stream: 1, bytes: chunk))
        var frame = try await next()
        while case .credit = frame { frame = try await next() }
        #expect(frame == .close(stream: 1, reason: "Relay sent past the phone's window."))
        _ = await browser.readToEnd()
        try await awaitActive(streams, 0)
    }

    @Test func endsEveryStreamWhenTheLinkGoesTellingABrowserStillWaitingWhy() async throws {
        let streams = streams()
        let open = try await browse(streams)
        _ = try await next()
        desktop(streams, .opened(stream: 1))
        let waiting = try await browse(streams, port: 3000)
        _ = try await next()
        queue.async { streams.reset("Connection lost.") }
        _ = await open.readToEnd()
        let page = try await waiting.page()
        #expect(page.hasPrefix("HTTP/1.1 502 ") && page.contains("Connection lost."), "\(page)")
        try await awaitActive(streams, 0)
    }

    @Test func givesUpOnAnOpenTheDesktopNeverAnswers() async throws {
        let streams = streams(openTimeout: .milliseconds(200))
        let browser = try await browse(streams)
        _ = try await next()
        #expect(try await next() == .close(stream: 1, reason: "The phone stopped waiting."))
        let page = try await browser.page()
        #expect(page.contains("Mac didn't answer."), "\(page)")
    }
}

// Not in the Android tests: the listeners' own answers, and the port they take.
@Suite(.timeLimit(.minutes(1)))
struct TunnelListenersTests {
    @Test func turnsConnectionsAwayUnlessABrowserHoldsThem() async throws {
        let listeners = TunnelListeners()
        // Below 1024 it's any free port.
        let local = try await listeners.listen(80)
        #expect(local != 80)
        #expect(try await listeners.listen(80) == local)
        #expect(listeners.desktopPort(local) == 80)
        #expect(listeners.desktop("http://127.0.0.1:\(local)/login") == SiteAddress(port: 80, path: "/login"))

        #expect(try await Browser(port: local).page().hasPrefix("HTTP/1.1 403 "))
        let release = listeners.hold()
        let offline = try await Browser(port: local).page()
        #expect(offline.hasPrefix("HTTP/1.1 503 ") && offline.contains("Not connected to your computer"), "\(offline)")
        let other = listeners.hold()
        release()
        release()
        #expect(try await Browser(port: local).page().hasPrefix("HTTP/1.1 503 "))
        other()
        #expect(try await Browser(port: local).page().hasPrefix("HTTP/1.1 403 "))
    }

    @Test func takesAnotherPortWhenTheDesktopsIsTakenHere() async throws {
        // The Simulator and a Mac share one loopback with the desktop's own servers.
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let taken = try NWListener(using: parameters)
        let bound = Inbox<Int>()
        taken.stateUpdateHandler = { [weak taken] state in
            if case .ready = state, let port = taken?.port { bound.put(Int(port.rawValue)) }
        }
        taken.newConnectionHandler = { $0.cancel() }
        taken.start(queue: DispatchQueue(label: "test.taken"))
        defer { taken.cancel() }
        let port = try #require(await bound.next())

        let listeners = TunnelListeners()
        let local = try await listeners.listen(port)
        #expect(local != port)
        #expect(listeners.localPort(port) == local)
        #expect(try await listeners.local(SiteAddress(port: port, path: "/x")) == "http://127.0.0.1:\(local)/x")
    }
}
