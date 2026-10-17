import Foundation
import Network

/// One link's port tunnel (shared/remote-tunnel.ts): each local connection
/// the listeners take becomes a stream to the same port on the desktop.
/// Everything here runs on `queue`, the client's, where frames arrive and the
/// connections report; that's what makes it Sendable. Network.framework never
/// blocks it, so neither a slow browser nor a slow link holds up the client.
public final class TunnelStreams: @unchecked Sendable {
    let queue: DispatchQueue
    private let window: Int
    private let openTimeout: DispatchTimeInterval
    private var streams: [UInt32: Stream] = [:]
    private var next: UInt32 = 1
    /// Seals and sends a frame on the link; nil while it's down or the desktop doesn't speak the tunnel.
    private var sender: ((TunnelFrame) -> Void)?
    /// The computer, as the pages a browser gets instead name it.
    var name: String

    init(
        queue: DispatchQueue, name: String, window: Int = TunnelLimits.window,
        openTimeout: DispatchTimeInterval = .seconds(15)
    ) {
        self.queue = queue
        self.name = name
        self.window = window
        self.openTimeout = openTimeout
    }

    /// Streams open on this link; the queue only.
    var active: Int { streams.count }

    /// The link is up and the desktop speaks the tunnel; frames go out through `send`. The queue only.
    func connect(_ send: @escaping (TunnelFrame) -> Void) { sender = send }

    func disconnect() { sender = nil }

    /// A local connection for `port` on the desktop; any thread.
    public func accept(_ connection: NWConnection, port: Int) {
        queue.async { [self] in
            guard sender != nil else { return Notice.serve(connection, Notice.offline(name), on: queue) }
            guard streams.count < TunnelLimits.maxStreams else {
                return Notice.serve(connection, Notice.busy, on: queue)
            }
            let s = Stream(id: next, port: port, connection: connection, credit: window)
            next &+= 1
            streams[s.id] = s
            send(.open(stream: s.id, port: port))
            start(s)
        }
    }

    /// A frame from the desktop; the queue only.
    func receive(_ frame: TunnelFrame) {
        guard let s = streams[frame.stream] else { return }
        switch frame {
        case .opened: opened(s)
        case .data(_, let bytes, let packed): data(s, bytes, packed: packed)
        case .credit(_, let bytes):
            s.credit += bytes
            read(s)
        case .end: end(s)
        case .close(_, let reason):
            streams[s.id] = nil
            closed(s, reason)
        case .open: fail(s, "Only the phone opens streams.")
        }
    }

    /// The link went away or moved: every stream ends; the queue only.
    func reset(_ reason: String) {
        let all = streams.values
        streams = [:]
        for s in all { s.open ? abort(s) : refuse(s, reason) }
    }

    private func send(_ frame: TunnelFrame) { sender?(frame) }

    private func current(_ s: Stream) -> Bool { streams[s.id] === s }

    private func fail(_ s: Stream, _ reason: String) {
        guard current(s) else { return }
        streams[s.id] = nil
        send(.close(stream: s.id, reason: reason))
        abort(s)
    }

    /// Nothing is read from the browser until the desktop says the stream is open.
    private func start(_ s: Stream) {
        s.connection.stateUpdateHandler = { [weak self, weak s] state in
            guard let self, let s, case .failed = state else { return }
            fail(s, "The phone's connection broke.")
        }
        s.connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + openTimeout) { [self] in
            guard current(s), !s.open else { return }
            streams[s.id] = nil
            send(.close(stream: s.id, reason: "The phone stopped waiting."))
            refuse(s, "\(name) didn't answer.")
        }
    }

    private func opened(_ s: Stream) {
        guard !s.open else { return }
        s.open = true
        read(s)
    }

    /// Carries the browser's bytes as far as the desktop's credit goes.
    private func read(_ s: Stream) {
        guard s.open, current(s), !s.reading, !s.readDone, s.credit > 0 else { return }
        s.reading = true
        s.connection.receive(minimumIncompleteLength: 1, maximumLength: min(TunnelLimits.chunk, s.credit)) {
            [self] data, _, ended, error in
            s.reading = false
            guard current(s) else { return }
            if let data, !data.isEmpty {
                s.credit -= data.count
                send(.data(stream: s.id, bytes: data))
            }
            if error != nil { return fail(s, "The phone's connection broke.") }
            if ended {
                s.readDone = true
                return send(.end(stream: s.id))
            }
            read(s)
        }
    }

    private func data(_ s: Stream, _ bytes: Data, packed: Bool) {
        guard s.open else { return fail(s, "Data came before the stream opened.") }
        let plain: Data
        do {
            plain = packed ? try Codec.inflate(bytes, cap: TunnelLimits.chunk) : bytes
        } catch {
            return fail(s, "A packed frame didn't unpack.")
        }
        s.unacked += plain.count
        if s.unacked > window { return fail(s, "Relay sent past the phone's window.") }
        write(s, plain)
    }

    /// Hands the desktop's bytes to the browser, crediting them back once the connection took them.
    private func write(_ s: Stream, _ bytes: Data) {
        s.writing += 1
        s.connection.send(
            content: bytes,
            completion: .contentProcessed { [self] error in
                s.writing -= 1
                if error != nil {
                    fail(s, "The phone's connection broke.")
                    return abort(s)
                }
                consumed(s, bytes.count)
                closeIfWritten(s)
            })
    }

    /// The desktop's side is done: the browser reads to the end of what came before.
    private func end(_ s: Stream) {
        guard s.open else { return }
        s.writing += 1
        s.connection.send(
            content: nil, contentContext: .finalMessage, isComplete: true,
            completion: .contentProcessed { [self] _ in
                s.writing -= 1
                closeIfWritten(s)
            })
    }

    /// Gone from the map already. An ordinary close lets the writes finish first.
    private func closed(_ s: Stream, _ reason: String) {
        guard s.open else { return refuse(s, reason.isEmpty ? "\(name) closed it." : reason) }
        guard reason.isEmpty else { return abort(s) }
        s.closing = true
        closeIfWritten(s)
    }

    private func closeIfWritten(_ s: Stream) {
        if s.closing, s.writing == 0 { s.connection.cancel() }
    }

    private func abort(_ s: Stream) {
        s.connection.stateUpdateHandler = nil
        s.connection.cancel()
    }

    private func refuse(_ s: Stream, _ reason: String) {
        Notice.serve(s.connection, Notice.refused(port: s.port, reason: reason, name: name), on: queue)
    }

    private func consumed(_ s: Stream, _ n: Int) {
        guard current(s) else { return }
        s.consumed += n
        guard s.consumed >= window / 4 else { return }
        send(.credit(stream: s.id, bytes: s.consumed))
        s.unacked -= s.consumed
        s.consumed = 0
    }
}

/// One browser connection carried to the desktop. Touched only on its streams' queue.
private final class Stream: @unchecked Sendable {
    let id: UInt32
    let port: Int
    let connection: NWConnection
    /// Bytes the desktop will still take; reading spends them, its credit gives them back.
    var credit: Int
    var open = false
    var reading = false
    /// The browser's side ended and the desktop was told.
    var readDone = false
    /// Sends the connection hasn't taken yet; an ordinary close waits for them.
    var writing = 0
    var closing = false
    /// The desktop's bytes not credited back yet, and of those, what the browser's connection took.
    var unacked = 0
    var consumed = 0

    init(id: UInt32, port: Int, connection: NWConnection, credit: Int) {
        self.id = id
        self.port = port
        self.connection = connection
        self.credit = credit
    }
}
