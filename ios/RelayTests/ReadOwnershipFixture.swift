import Foundation
import RelayRemote
import Security
import Synchronization
import Testing
import UIKit

@testable import Relay

/// A real RemoteClient and Connection, with just the WebSocket peer in memory.
/// Each fixture has its own pairings; it never reads or writes the app's credentials.
@MainActor
final class ReadOwnershipFixture {
    let a = ReadDesktop(name: "A", imageSide: 1)
    let b = ReadDesktop(name: "B", imageSide: 2, bridge: Bridge.image - 1)
    let connection: Connection
    private let service = "dev.relay.tests.\(UUID().uuidString)"
    private let pool: Clients

    private final class Clients {
        var byKey: [String: RemoteClient] = [:]
    }

    init() {
        let pool = Clients()
        pool.byKey[a.credentials.key] = a.client()
        pool.byKey[b.credentials.key] = b.client()
        self.pool = pool
        let store = CredentialStore(service: service)
        store.save([a.credentials, b.credentials], active: a.credentials.key)
        connection = Connection(store: store) { start in
            guard case .saved(let credentials) = start, let client = pool.byKey[credentials.key] else {
                preconditionFailure("Unexpected test connection")
            }
            return client
        }
    }

    static func run(_ test: (ReadOwnershipFixture) async throws -> Void) async throws {
        let fixture = ReadOwnershipFixture()
        do {
            try await fixture.start()
            try await test(fixture)
        } catch {
            await fixture.stop()
            throw error
        }
        await fixture.stop()
    }

    func start() async throws {
        connection.launch()
        try await until { connection.overview?.name == "A" }
        // B is already online when switched to, so a wrongly routed read succeeds
        // with B's distinct image instead of being hidden by a connection failure.
        let client = pool.byKey[b.credentials.key]!
        await client.start()
        try await until { await client.status.state == .online }
    }

    func replaceA() async throws -> RemoteClient {
        let client = a.client()
        await client.start()
        try await until { await client.status.state == .online }
        pool.byKey[a.credentials.key] = client
        return client
    }

    func stop() async {
        let active = connection.active
        for computer in connection.computers where computer.key != active { connection.forget(computer.key) }
        if let active { connection.forget(active) }
        for client in pool.byKey.values { await client.close() }
        a.discardPendingCalls()
        b.discardPendingCalls()
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service] as CFDictionary)
    }

    func until(_ condition: () async -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while !(await condition()) {
            try #require(ContinuousClock.now < deadline, "Expected request/connection state did not arrive")
            await Task.yield()
        }
    }
}

/// The desktop half of the real encrypted protocol. Socket/channel state stays on
/// the RemoteClient's queue; the mutex only shares recorded calls with the test.
nonisolated final class ReadDesktop: SocketFactory, @unchecked Sendable {
    struct Call: Sendable {
        let method: String
        let args: [JSON]
    }

    private struct State {
        var calls: [Call] = []
        var sites: [(Socket, JSON)] = []
        var desktop: [(Socket, JSON)] = []
    }

    let credentials: RemoteCredentials
    private let key = KeyPair.generate()
    private let bridge: Int
    private let image: String
    private let state = Mutex(State())

    @MainActor init(name: String, imageSide: Int, bridge: Int = Bridge.version) {
        self.bridge = bridge
        credentials = RemoteCredentials(
            hosts: ["127.0.0.1"], port: 1, key: Base64URL.encode(key.publicKey), name: name,
            deviceId: "test-phone", token: "test-token")
        let size = CGSize(width: imageSide, height: imageSide)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let png = UIGraphicsImageRenderer(size: size, format: format).pngData { context in
            UIColor.red.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
        image = "data:image/png;base64," + png.base64EncodedString()
    }

    var calls: [Call] { state.withLock { $0.calls } }
    var pendingSites: Int { state.withLock { $0.sites.count } }
    var pendingDesktop: Int { state.withLock { $0.desktop.count } }
    var desktopCalls: [Call] { calls.filter { $0.method == "desktop" } }
    var imageCalls: [Call] {
        calls.filter { $0.method == "image" || ($0.method == "desktop" && $0.args.first?.string == "projectChatImage") }
    }

    func client() -> RemoteClient { RemoteClient(.saved(credentials), sockets: self) }

    func discardPendingCalls() {
        state.withLock {
            $0.sites = []
            $0.desktop = []
        }
    }

    func open(url: URL, queue: DispatchQueue, handler: @escaping @Sendable (SocketEvent) -> Void) -> any RemoteSocket {
        let socket = Socket(desktop: self, queue: queue, handler: handler)
        queue.async { handler(.open) }
        return socket
    }

    /// Queue the successful answer while the test still owns the main actor, then
    /// drain the client's serial queue. The app cannot consume it until the test
    /// switches computers without yielding; closing the old client is too late
    /// to retract this already-completed call.
    func answerSites(_ ports: [Int]) throws {
        let (socket, id) = try #require(state.withLock { $0.sites.isEmpty ? nil : $0.sites.removeFirst() })
        let sites = ports.map { RemoteSite(port: $0, title: "Dev", command: "dev", projectId: "p", project: credentials.name) }
        let value = try JSON(encoding: sites)
        socket.queue.sync { socket.reply(id, value) }
        socket.queue.sync {}
    }

    /// As with Sites, finish on the socket queue before the app can consume the result.
    func answerDesktop(_ value: JSON) throws {
        let (socket, id) = try #require(state.withLock { $0.desktop.isEmpty ? nil : $0.desktop.removeFirst() })
        socket.queue.sync { socket.reply(id, value) }
        socket.queue.sync {}
    }

    private func called(_ frame: JSON, socket: Socket) {
        guard let method = frame["method"]?.string, let id = frame["id"] else { return }
        let args = frame["args"]?.array ?? []
        state.withLock { $0.calls.append(Call(method: method, args: args)) }
        switch method {
        case "sites": state.withLock { $0.sites.append((socket, id)) }
        case "overview":
            socket.reply(id, ["name": .string(credentials.name), "bridge": .number(Double(bridge)), "projects": [], "chats": []])
        case "image": socket.reply(id, .string(image))
        case "desktop" where args.first?.string == "projectChatImage": socket.reply(id, .string(image))
        case "desktop": state.withLock { $0.desktop.append((socket, id)) }
        default: socket.reply(id, .null)
        }
    }

    private final class Socket: RemoteSocket, @unchecked Sendable {
        let queue: DispatchQueue
        private let desktop: ReadDesktop
        private let handler: @Sendable (SocketEvent) -> Void
        private var channel: Channel?
        private var cancelled = false

        init(desktop: ReadDesktop, queue: DispatchQueue, handler: @escaping @Sendable (SocketEvent) -> Void) {
            self.desktop = desktop
            self.queue = queue
            self.handler = handler
        }

        func send(_ data: WireData) {
            guard !cancelled else { return }
            do {
                guard let channel else {
                    guard case .text(let hello) = data else { return }
                    let handshake = try ServerHandshake(staticKey: desktop.key, clientHello: hello)
                    self.channel = handshake.channel
                    let reply = handshake.hello
                    queue.async { self.handler(.message(.text(reply))) }
                    return
                }
                let frame = try JSON.parse(openFrame(channel, data))
                if frame["t"]?.string == "auth" {
                    emit(["t": "ready", "bridge": .number(Double(desktop.bridge))])
                } else if frame["t"]?.string == "call" {
                    desktop.called(frame, socket: self)
                }
            } catch {
                Issue.record("Invalid test bridge frame: \(error)")
            }
        }

        func reply(_ id: JSON, _ value: JSON) { emit(["t": "result", "id": id, "ok": true, "value": value]) }

        private func emit(_ frame: JSON) {
            guard !cancelled, let channel else { return }
            let wire = sealFrame(channel, frame.text(), compact: desktop.bridge >= Bridge.compact)
            // A real socket delivers later on this queue, never reentrantly from send.
            queue.async { if !self.cancelled { self.handler(.message(wire)) } }
        }

        func cancel() { cancelled = true }
    }
}
