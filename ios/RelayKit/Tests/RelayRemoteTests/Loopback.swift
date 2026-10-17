import Foundation
import Network
import Synchronization

/// What another thread hands over, taken in order; nil once `within` passes without any.
final class Inbox<T: Sendable>: Sendable {
    private struct State {
        var items: [T] = []
        var waiter: CheckedContinuation<T?, Never>?
        /// Which wait `waiter` is, so a timeout ends only its own.
        var waits = 0
    }

    private let state = Mutex(State())

    func put(_ item: T) {
        let waiter = state.withLock { s in
            defer { s.waiter = nil }
            if s.waiter == nil { s.items.append(item) }
            return s.waiter
        }
        waiter?.resume(returning: item)
    }

    func next(within timeout: Duration = .seconds(10)) async -> T? {
        await withCheckedContinuation { waiter in
            let (wait, ready) = state.withLock { s -> (Int, T?) in
                if !s.items.isEmpty { return (0, s.items.removeFirst()) }
                s.waits += 1
                s.waiter = waiter
                return (s.waits, nil)
            }
            if let ready { return waiter.resume(returning: ready) }
            Task {
                try? await Task.sleep(for: timeout)
                let late = state.withLock { s in
                    defer { if s.waits == wait { s.waiter = nil } }
                    return s.waits == wait ? s.waiter : nil
                }
                late?.resume(returning: nil)
            }
        }
    }
}

/// A browser's end of a loopback connection.
final class Browser: Sendable {
    private static let queue = DispatchQueue(label: "test.browser")
    let connection: NWConnection

    init(port: Int) {
        connection = NWConnection(
            host: .ipv4(.loopback), port: NWEndpoint.Port(integerLiteral: UInt16(port)), using: .tcp)
        connection.start(queue: Self.queue)
    }

    deinit { connection.cancel() }

    func write(_ bytes: Data) async throws {
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            connection.send(
                content: bytes,
                completion: .contentProcessed { error in
                    if let error { done.resume(throwing: error) } else { done.resume() }
                })
        }
    }

    func write(_ text: String) async throws { try await write(Data(text.utf8)) }

    /// TCP FIN: nothing more from the browser.
    func shutdownOutput() {
        connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .idempotent)
    }

    /// Up to `max` bytes; nil at the end, a reset counting as one.
    func read(max: Int = 64 * 1024) async -> Data? {
        await withCheckedContinuation { done in
            connection.receive(minimumIncompleteLength: 1, maximumLength: max) { data, _, _, _ in
                done.resume(returning: data.flatMap { $0.isEmpty ? nil : $0 })
            }
        }
    }

    func readExactly(_ n: Int) async -> Data {
        var out = Data()
        while out.count < n, let more = await read(max: n - out.count) { out.append(more) }
        return out
    }

    func readToEnd() async -> Data {
        var out = Data()
        while let more = await read() { out.append(more) }
        return out
    }

    /// A notice page: the browser sends its request and reads to the end.
    func page() async throws -> String {
        try await write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        return String(decoding: await readToEnd(), as: UTF8.self)
    }
}
