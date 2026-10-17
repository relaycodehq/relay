import Foundation
import Network

/// The page a local connection gets when the tunnel can't carry it, so the
/// browser shows why instead of spinning. Anything that isn't a browser gets
/// the same HTTP answer and goes away.
enum Notice {
    struct Page: Sendable {
        let status: String
        let title: String
        let detail: String
    }

    static func offline(_ name: String) -> Page {
        Page(
            status: "503 Service Unavailable", title: "Not connected to \(name)",
            detail: "This page loads once the phone reaches \(name) again.")
    }

    static let busy = Page(
        status: "503 Service Unavailable", title: "Too many connections", detail: "Close a few pages and try again.")

    static func refused(port: Int, reason: String, name: String) -> Page {
        Page(status: "502 Bad Gateway", title: "\(name) didn't open localhost:\(port)", detail: reason)
    }

    static let notHeld = Page(
        status: "403 Forbidden",
        title: "Open this from Relay",
        detail: "Relay passes connections to your computer only while its browser is open."
    )

    /// Answers on `queue`, the caller's, starting the connection there unless it runs already.
    static func serve(_ connection: NWConnection, _ page: Page, on queue: DispatchQueue) {
        Answer(connection, response(page), queue).start()
    }

    static func response(_ page: Page) -> Data {
        let body = Data(
            """
            <!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>\(html(page.title))</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:56px 24px;color:#1f1f1f;background:#fff}
            @media(prefers-color-scheme:dark){body{color:#e6e6e6;background:#141414}}h1{font-size:17px;font-weight:600;margin:0 0 6px}p{margin:0;opacity:.6}</style>
            <h1>\(html(page.title))</h1><p>\(html(page.detail))</p>
            """.utf8)
        let head =
            "HTTP/1.1 \(page.status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\n"
            + "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
        return Data(head.utf8) + body
    }

    private static func html(_ text: String) -> String {
        text.replacing("&", with: "&amp;").replacing("<", with: "&lt;").replacing(">", with: "&gt;")
    }
}

/// One notice on its way: up to the request's blank line (16 KiB at most),
/// the page, then the browser's leftovers until it closes. Two seconds of
/// silence ends it. Touched only on `queue`.
private final class Answer: @unchecked Sendable {
    private static let blank = Data("\r\n\r\n".utf8)
    private let connection: NWConnection
    private let response: Data
    private let queue: DispatchQueue
    private var head = Data()
    /// Counts reads, so a read's timeout knows whether another came since.
    private var reads = 0
    private var done = false

    init(_ connection: NWConnection, _ response: Data, _ queue: DispatchQueue) {
        self.connection = connection
        self.response = response
        self.queue = queue
    }

    func start() {
        connection.stateUpdateHandler = { [self] state in
            if case .failed = state { finish() }
        }
        if case .setup = connection.state { connection.start(queue: queue) }
        readHead()
    }

    private func readHead() {
        receive { [self] data, ended in
            if let data { head.append(data) }
            if ended || head.count >= 16 * 1024 || head.range(of: Self.blank) != nil { return answer() }
            readHead()
        }
    }

    private func answer() {
        connection.send(
            content: response, contentContext: .finalMessage, isComplete: true,
            completion: .contentProcessed { [self] error in
                if error != nil { return finish() }
                // Closing with the browser's bytes unread would reset the connection before it reads the page.
                drain()
            })
    }

    private func drain() {
        receive { [self] _, ended in ended ? finish() : drain() }
    }

    /// One read; an error or two quiet seconds finish instead.
    private func receive(_ then: @escaping @Sendable (Data?, Bool) -> Void) {
        reads += 1
        let mine = reads
        queue.asyncAfter(deadline: .now() + 2) { [self] in
            if reads == mine { finish() }
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [self] data, _, ended, error in
            guard !done else { return }
            reads += 1
            if error != nil { return finish() }
            then(data, ended)
        }
    }

    private func finish() {
        guard !done else { return }
        done = true
        connection.stateUpdateHandler = nil
        connection.cancel()
    }
}
