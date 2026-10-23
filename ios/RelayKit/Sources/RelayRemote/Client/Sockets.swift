import Foundation
import Network

public enum SocketEvent: Sendable {
    case open
    case message(WireData)
    /// iOS is keeping this app off the local network: asking the user, or told no.
    /// The socket waits, as allowing it lets the connection go on.
    case blocked
    /// Closed or failed, either way. Comes once.
    case closed
}

/// What the client needs of a WebSocket, so tests can stand in for the network.
public protocol RemoteSocket: AnyObject, Sendable {
    func send(_ data: WireData)
    /// Gone at once; nothing more is heard from it.
    func cancel()
}

public protocol SocketFactory: Sendable {
    /// `handler` runs on `queue`, the client's own.
    func open(url: URL, queue: DispatchQueue, handler: @escaping @Sendable (SocketEvent) -> Void) -> RemoteSocket
}

/// WebSockets over Network.framework: plain `ws://` to a LAN or Tailscale
/// address, which URLSession's App Transport Security would refuse for names.
public struct NWSockets: SocketFactory {
    public init() {}

    public func open(url: URL, queue: DispatchQueue, handler: @escaping @Sendable (SocketEvent) -> Void) -> RemoteSocket {
        NWSocket(url: url, queue: queue, handler: handler)
    }
}

/// Everything here runs on the queue it was started on.
final class NWSocket: RemoteSocket, @unchecked Sendable {
    private let connection: NWConnection
    private let handler: @Sendable (SocketEvent) -> Void
    private var ended = false
    private var blocked = false

    init(url: URL, queue: DispatchQueue, handler: @escaping @Sendable (SocketEvent) -> Void) {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        // Match the desktop's sealed-frame budget.
        ws.maximumMessageSize = Codec.maxFrameBytes
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        connection = NWConnection(to: .url(url), using: parameters)
        self.handler = handler
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                handler(.open)
                receive()
            case .waiting where connection.currentPath?.unsatisfiedReason == .localNetworkDenied:
                if !blocked {
                    blocked = true
                    handler(.blocked)
                }
            // Otherwise waiting means refused or unreachable; the client tries the next route rather than wait it out.
            case .waiting, .failed, .cancelled: end()
            default: break
            }
        }
        connection.start(queue: queue)
    }

    private func end() {
        guard !ended else { return }
        ended = true
        connection.cancel()
        handler(.closed)
    }

    private func receive() {
        connection.receiveMessage { [weak self] content, context, _, error in
            guard let self, !ended else { return }
            if error != nil { return end() }
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
                as? NWProtocolWebSocket.Metadata
            switch metadata?.opcode {
            case .text: handler(.message(.text(String(decoding: content ?? Data(), as: UTF8.self))))
            case .binary: handler(.message(.binary(content ?? Data())))
            case .close: return end()
            default: break
            }
            receive()
        }
    }

    func send(_ data: WireData) {
        guard !ended else { return }
        let opcode: NWProtocolWebSocket.Opcode
        let bytes: Data
        switch data {
        case .text(let text):
            opcode = .text
            bytes = Data(text.utf8)
        case .binary(let b):
            opcode = .binary
            bytes = b
        }
        let context = NWConnection.ContentContext(
            identifier: "frame", metadata: [NWProtocolWebSocket.Metadata(opcode: opcode)])
        connection.send(content: bytes, contentContext: context, isComplete: true, completion: .idempotent)
    }

    func cancel() {
        ended = true
        connection.cancel()
    }
}
