import Foundation
import Network
import Synchronization

/// The phone's loopback listeners, one per desktop port its browser opened,
/// handing each connection to the live link's `TunnelStreams`. They stay for
/// the app's life, so a page keeps its port, and with it its origin, across
/// reconnects; one iOS takes back while the app is suspended binds again at
/// the next `listen`. They serve whichever computer is live, and so the same
/// origin for each; the browser should keep each computer's storage apart.
/// While no browser `hold`s them they turn connections away: any app on the
/// phone can reach 127.0.0.1.
public final class TunnelListeners: Sendable {
    private struct State {
        var streams: TunnelStreams?
        var holds = 0
        /// Desktop port → the phone's.
        var bound: [Int: Int] = [:]
        var listeners: [Int: NWListener] = [:]
        /// Binds under way or done, so two asking for one port share one.
        var binding: [Int: Task<Int, Error>] = [:]
    }

    private let state = Mutex(State())
    private let queue = DispatchQueue(label: "relay.tunnel.listen")

    public init() {}

    /// Where connections go: the live client's `tunnel`, nil while there's none.
    public var streams: TunnelStreams? {
        get { state.withLock { $0.streams } }
        set { state.withLock { $0.streams = newValue } }
    }

    /// Lets connections through until the returned release runs; call it as the browser closes.
    public func hold() -> @Sendable () -> Void {
        state.withLock { $0.holds += 1 }
        let once = Once()
        return { [self] in
            if once.claim() { state.withLock { $0.holds -= 1 } }
        }
    }

    /// The phone's port for `desktopPort`, listening from now on: the same port when it's free and
    /// at least 1024, else any.
    public func listen(_ desktopPort: Int) async throws -> Int {
        let binding = state.withLock { s in
            if let task = s.binding[desktopPort] { return task }
            let task = Task { try await self.bind(desktopPort) }
            s.binding[desktopPort] = task
            return task
        }
        do {
            return try await binding.value
        } catch {
            state.withLock { s in
                if s.binding[desktopPort] == binding { s.binding[desktopPort] = nil }
            }
            throw error
        }
    }

    /// What the browser loads for `address`, listening for its port first.
    public func local(_ address: SiteAddress) async throws -> String {
        LocalUrls.local(address, localPort: try await listen(address.port))
    }

    /// The desktop's address for a URL the browser is on; nil for one no listener serves.
    public func desktop(_ url: String) -> SiteAddress? {
        LocalUrls.desktop(url, desktopPortOf: desktopPort)
    }

    public func localPort(_ desktopPort: Int) -> Int? { state.withLock { $0.bound[desktopPort] } }

    /// The desktop ports listened for.
    public func listening() -> Set<Int> { state.withLock { Set($0.bound.keys) } }

    public func desktopPort(_ localPort: Int) -> Int? {
        state.withLock { $0.bound.first { $0.value == localPort }?.key }
    }

    private func bind(_ desktopPort: Int) async throws -> Int {
        let preferred = LocalUrls.preferredPort(desktopPort)
        let listener: NWListener
        do {
            listener = try await start(preferred, for: desktopPort)
        } catch where preferred != 0 {
            listener = try await start(0, for: desktopPort)
        }
        let port = Int(listener.port?.rawValue ?? 0)
        state.withLock {
            $0.bound[desktopPort] = port
            $0.listeners[desktopPort] = listener
        }
        return port
    }

    private func start(_ port: Int, for desktopPort: Int) async throws -> NWListener {
        let parameters = NWParameters.tcp
        (parameters.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options)?.noDelay = true
        parameters.requiredLocalEndpoint = .hostPort(
            host: .ipv4(.loopback), port: NWEndpoint.Port(integerLiteral: UInt16(port)))
        let listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection, desktopPort) }
        let started = Once()
        return try await withCheckedThrowingContinuation { result in
            listener.stateUpdateHandler = { [weak self, weak listener] state in
                guard let listener else { return }
                switch state {
                case .ready:
                    if started.claim() { result.resume(returning: listener) }
                case .failed(let error):
                    listener.cancel()
                    if started.claim() { result.resume(throwing: error) } else { self?.lost(desktopPort, listener) }
                case .waiting(let error) where started.claim():
                    listener.cancel()
                    result.resume(throwing: error)
                default: break
                }
            }
            listener.start(queue: queue)
        }
    }

    /// iOS took a listener back; the next `listen` for its port binds again.
    private func lost(_ desktopPort: Int, _ listener: NWListener) {
        state.withLock { s in
            guard s.listeners[desktopPort] === listener else { return }
            s.listeners[desktopPort] = nil
            s.bound[desktopPort] = nil
            s.binding[desktopPort] = nil
        }
    }

    private func accept(_ connection: NWConnection, _ desktopPort: Int) {
        let (held, link) = state.withLock { ($0.holds > 0, $0.streams) }
        if !held {
            Notice.serve(connection, Notice.notHeld, on: queue)
        } else if let link {
            link.accept(connection, port: desktopPort)
        } else {
            Notice.serve(connection, Notice.offline("your computer"), on: queue)
        }
    }
}

/// True for the first caller only.
final class Once: Sendable {
    private let done = Mutex(false)

    func claim() -> Bool {
        done.withLock { done in
            defer { done = true }
            return !done
        }
    }
}
