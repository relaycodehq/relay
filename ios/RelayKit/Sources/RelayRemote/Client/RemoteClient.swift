import Foundation

/// The phone's connection to the desktop bridge, a port of shared/remote-client.
/// An actor on its own serial queue: socket callbacks land on that queue and
/// run in order, so every frame opens under the right counter.
public actor RemoteClient {
    let queue = DispatchSerialQueue(label: "relay.remote", qos: .userInitiated)
    public nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

    let options: RemoteClientOptions
    let sockets: SocketFactory
    let warn: @Sendable (String) -> Void

    var target: RemoteStart
    var host: String?
    var bridgeVersion: Int?
    public private(set) var status = RemoteStatus(.offline)

    /// Status, events and credentials, in order. One reader.
    public nonisolated let updates: AsyncStream<RemoteUpdate>
    private let sink: AsyncStream<RemoteUpdate>.Continuation

    var current: Dial?
    var channel: Channel?
    /// Dials taking part in a race, for `racing` and `cancelRaces`.
    var raceDials: [ObjectIdentifier: Dial] = [:]
    private var calls: [Int: PendingCall] = [:]
    private var nextCall = 1
    private var uploads = 0
    var closed = true
    private var retry = 0
    private var retryTimer: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var heard = ContinuousClock.now
    private var attempt = 0
    private var betterTimer: Task<Void, Never>?
    private var worse: [String: ContinuousClock.Instant] = [:]
    private var wireEvents = ConnectionEvents()

    /// Raw TCP to the desktop's own loopback over this link, from `Bridge.tunnel`.
    /// Give it to `TunnelListeners.streams` while this is the live client.
    public nonisolated let tunnel: TunnelStreams

    private struct PendingCall {
        let result: CheckedContinuation<JSON, Error>
        let timer: Task<Void, Never>
    }

    public init(
        _ start: RemoteStart,
        sockets: SocketFactory = NWSockets(),
        options: RemoteClientOptions = .init(),
        warn: @escaping @Sendable (String) -> Void = { print($0) }
    ) {
        target = start
        self.sockets = sockets
        self.options = options
        self.warn = warn
        (updates, sink) = AsyncStream.makeStream(bufferingPolicy: .unbounded)
        tunnel = TunnelStreams(queue: queue, name: start.name)
    }

    /// The desktop's name, from the link or the saved credentials.
    public var name: String { target.name }

    /// The connected desktop's bridge version; nil while offline or for desktops that don't say.
    public var bridge: Int? { bridgeVersion }

    /// Whether the connected desktop speaks a bridge feature, e.g. `supports(Bridge.drafts)`.
    public func supports(_ feature: Int) -> Bool { (bridgeVersion ?? 0) >= feature }

    public var credentials: RemoteCredentials? { target.credentials }

    /// Which way the link runs now.
    public var route: RemoteRoute? {
        guard status.state == .online, let host else { return nil }
        return RemoteRoute(host: host, kind: Routes.kind(host))
    }

    var routes: [RouteKind] { target.credentials?.routes ?? Routes.defaultOrder }

    var endpoint: Endpoint {
        switch target {
        case .pair(let link, _, _): Endpoint(hosts: link.hosts, port: link.port, key: link.key)
        case .saved(let c): Endpoint(hosts: c.hosts, port: c.port, key: c.key)
        }
    }

    public func start() {
        guard closed else { return }
        closed = false
        connect()
    }

    public func close() {
        closed = true
        retryTimer?.cancel()
        cancelRaces()
        drop("Disconnected.")
        setStatus(.offline)
        sink.finish()
    }

    /// A new order: kept with the credentials, and the link moves if an earlier route answers.
    public func setRoutes(_ routes: [RouteKind]) {
        guard case .saved(var c) = target else { return }
        c.routes = routes
        target = .saved(c)
        sink.yield(.credentials(c))
        worse = [:]
        tryBetter()
    }

    /// Reconnects now instead of waiting out the backoff, e.g. back in the
    /// foreground. A link quiet for more than half the stale time is likely
    /// dead (iOS drops sockets in the background), so it reconnects.
    public func wake() {
        let state = status.state
        guard !closed, state != .denied else { return }
        let quiet = state == .online && ContinuousClock.now - heard > options.stale / 2
        if state == .offline || quiet {
            if quiet { drop("Connection lost.") }
            retryTimer?.cancel()
            retry = 0
            connect()
        } else if state == .online {
            worse = [:]
            tryBetter()
        }
    }

    /// One bridge call. Throws `RemoteCallError`. Nils go as JSON null.
    public func call(_ method: String, _ args: [JSON?] = [], timeout: Duration? = nil) async throws -> JSON {
        let wait = timeout ?? (Bridge.slowRemoteMethods.contains(method) ? options.slowTimeout : options.timeout)
        return try await request(method, .array(args.map { $0 ?? .null }), wait)
    }

    /// One of the desktop's own calls on the phone's allowlist. Trailing nils
    /// go (JSON would turn a left-out argument into null, which the desktop
    /// refuses), and a send's `to` goes for desktops that don't know it.
    public func desktop(_ method: String, _ args: [JSON?] = []) async throws -> JSON {
        var sent = args
        while let last = sent.last, last == nil || last == .null { sent.removeLast() }
        if method == "sendProjectChat", (bridgeVersion ?? 0) < Bridge.recipient, sent.count > 1,
            case .object(var send)? = sent[1]
        {
            send.removeValue(forKey: "to")
            sent[1] = .object(send)
        }
        let wait = Bridge.slowPhoneMethods.contains(method) ? options.slowTimeout : options.timeout
        return try await request("desktop", [.string(method), .array(sent.map { $0 ?? .null })], wait)
    }

    private func request(_ method: String, _ args: JSON, _ wait: Duration) async throws -> JSON {
        guard status.state == .online, channel != nil else {
            throw RemoteCallError.notConnected("Not connected to \(name).")
        }
        let id = nextCall
        nextCall += 1
        let frame: JSON = ["t": "call", "id": .number(Double(id)), "method": .string(method), "args": args]
        let json = frame.text()
        if !frameFits(json, compact: (bridgeVersion ?? 0) >= Bridge.compact) {
            guard MessageBatches.allows(method, args) else {
                throw RemoteCallError.rejected("This request is too large to send.")
            }
            guard (bridgeVersion ?? 0) >= Bridge.messageBatches else {
                throw RemoteCallError.rejected("Update Relay on your computer to send this many attachments.")
            }
            let bytes = Data(json.utf8)
            guard bytes.count <= MessageBatches.maxBytes else {
                throw RemoteCallError.rejected("This message is too large to send. Remove some attachments and try again.")
            }
            let uploading = channel
            var result = JSON.null
            uploads += 1
            defer { uploads -= 1 }
            do {
                for (n, offset) in stride(from: 0, to: bytes.count, by: MessageBatches.chunkBytes).enumerated() {
                    try Task.checkCancellation()
                    guard channel === uploading, status.state == .online else {
                        throw RemoteCallError.unanswered("The connection changed while uploading. Send the message again.")
                    }
                    let end = min(offset + MessageBatches.chunkBytes, bytes.count)
                    let part = nextCall
                    nextCall += 1
                    result = try await exchange([
                        "t": "batch", "id": .number(Double(part)), "batch": .number(Double(id)), "n": .number(Double(n)),
                        "data": .string(Base64URL.encode(bytes[offset..<end])), "last": .bool(end == bytes.count),
                    ], id: part, wait: wait)
                }
                return result
            } catch {
                if channel === uploading { sendFrame(["t": "batchCancel", "batch": .number(Double(id))]) }
                throw error
            }
        }
        return try await exchange(frame, id: id, wait: wait)
    }

    private func exchange(_ frame: JSON, id: Int, wait: Duration) async throws -> JSON {
        return try await withCheckedThrowingContinuation { result in
            let timer = after(wait) { client in
                guard let call = client.calls.removeValue(forKey: id) else { return }
                call.result.resume(throwing: RemoteCallError.unanswered("\(client.name) didn't answer in time."))
            }
            calls[id] = PendingCall(result: result, timer: timer)
            sendFrame(frame)
        }
    }

    /// Runs `action` on the client after `delay`, unless the task is cancelled first.
    func after(_ delay: Duration, _ action: @escaping @Sendable (isolated RemoteClient) -> Void) -> Task<Void, Never> {
        Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            await self.fire(action)
        }
    }

    private func fire(_ action: @Sendable (isolated RemoteClient) -> Void) {
        // Cancelled while hopping over: the timer was stopped before it could run.
        guard !Task.isCancelled else { return }
        action(self)
    }

    func setStatus(_ state: LinkState, _ detail: String? = nil) {
        status = RemoteStatus(state, detail)
        sink.yield(.status(status))
    }

    private func connect() {
        attempt += 1
        let mine = attempt
        cancelRaces()
        setStatus(.connecting)
        let pairing = if case .pair = target { true } else { false }
        race(
            endpoint, pairing: pairing, order: Routes.order(endpoint.hosts, routes: routes),
            RaceHandlers(
                stale: { [unowned self] in closed || mine != attempt },
                claim: { [unowned self] _, link in
                    attach(link)
                    return true
                },
                failed: { [unowned self] race, error in
                    if case .denied(let message) = error {
                        closed = true
                        setStatus(.denied, message)
                        return
                    }
                    if case .blocked(let message) = error {
                        race.blocked = true
                        race.reason = message
                    } else if !race.blocked, !error.message.isEmpty {
                        race.reason = error.message
                    }
                },
                done: { [unowned self] race in
                    setStatus(.offline, race.reason ?? "Can't reach \(name).")
                    scheduleRetry()
                }
            )
        )
    }

    private func scheduleRetry() {
        retryTimer?.cancel()
        let wait = min(15_000, 1000 << min(retry, 14))
        retry += 1
        retryTimer = after(.milliseconds(wait)) { $0.connect() }
    }

    /// Takes a signed-in link as the connection, the desktop's word on its addresses with it.
    func attach(_ link: Link) {
        current = link.dial
        channel = link.channel
        host = link.host
        bridgeVersion = link.frame.bridge
        wireEvents.reset()
        // Streams belong to the socket they opened on.
        tunnel.reset("Relay moved to another route.")
        let fresh = link.frame.hosts?.filter(validHost)
        switch target {
        case .pair(let pairing, _, _) where link.frame.t == "paired":
            let credentials = RemoteCredentials(
                hosts: fresh.map { $0.isEmpty ? pairing.hosts : Routes.learn($0, via: link.host) } ?? pairing.hosts,
                port: pairing.port,
                key: pairing.key,
                name: link.frame.name ?? pairing.name,
                deviceId: link.frame.deviceId ?? "",
                token: link.frame.token ?? ""
            )
            target = .saved(credentials)
            sink.yield(.paired(credentials))
        case .saved(let was):
            var next = was
            if let fresh, !fresh.isEmpty { next.hosts = Routes.learn(fresh, via: link.host) }
            next.name = link.frame.name ?? was.name
            target = .saved(next)
            if next.hosts != was.hosts || next.name != was.name { sink.yield(.credentials(next)) }
        default: break
        }
        tunnel.name = name
        if supports(Bridge.tunnel) {
            let (channel, dial) = (link.channel, link.dial)
            tunnel.connect { dial.socket?.send(sealTunnel(channel, $0)) }
        } else {
            tunnel.disconnect()
        }
        retry = 0
        keepAlive(link.dial)
        watchRoutes()
        setStatus(.online)
    }

    /// While the link runs over a later route than it could, looks for an earlier one now and then.
    private func watchRoutes() {
        betterTimer?.cancel()
        betterTimer = nil
        guard !better().isEmpty else { return }
        let every = options.betterRoute
        betterTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: every)
                guard !Task.isCancelled, let self else { return }
                await self.fire { $0.tryBetter() }
            }
        }
    }

    /// Hosts ahead of the current one in the order, but not those that just lost to it.
    private func better() -> [String] {
        let order = Routes.order(endpoint.hosts, routes: routes)
        guard let host, let at = order.firstIndex(of: host) else { return [] }
        let cooled = ContinuousClock.now - options.worseCooldown
        return order[..<at].filter { h in worse[h].map { $0 < cooled } ?? true }
    }

    /// Signs in over an earlier route beside the running link and swaps to it
    /// once it's in, so nothing shows as offline. Only between calls: an
    /// answer on its way comes back on the socket it went out on.
    func tryBetter() {
        guard status.state == .online, !racing else { return }
        let hosts = better()
        guard !hosts.isEmpty else { return watchRoutes() }
        let was = current
        let pairing = if case .pair = target { true } else { false }
        race(
            endpoint, pairing: pairing, order: hosts,
            RaceHandlers(
                stale: { [unowned self] in closed || current !== was },
                claim: { [unowned self] race, link in
                    // A move would cut open pages' connections, Vite's live reload among them.
                    if !calls.isEmpty || uploads > 0 || tunnel.active > 0 {
                        race.busy = true
                        return false
                    }
                    if let current { quit(current) }
                    watchdog?.cancel()
                    attach(link)
                    return true
                },
                done: { [unowned self] race in
                    if !race.busy { for h in hosts { worse[h] = .now } }
                    watchRoutes()
                }
            )
        )
    }

    func receive(_ frame: ServerFrame) {
        switch frame.t {
        case "tick":
            guard let fresh = frame.hosts, case .saved(var c) = target, let host else { return }
            // A network can change without dropping the listener or Tailscale; keep the next connect's routes current.
            let hosts = Routes.learn(fresh.filter(validHost), via: host)
            guard hosts != c.hosts else { return }
            c.hosts = hosts
            target = .saved(c)
            sink.yield(.credentials(c))
            worse = [:]
            watchRoutes()
            tryBetter()
        case "result":
            guard let id = frame.id, let call = calls.removeValue(forKey: id) else { return }
            call.timer.cancel()
            if frame.ok == true {
                call.result.resume(returning: frame.value ?? .null)
            } else {
                call.result.resume(throwing: RemoteCallError.rejected(frame.error ?? "Relay refused that."))
            }
        case "event":
            if let s = frame.s { sendFrame(["t": "got", "s": .number(Double(s))]) }
            guard let event = frame.event else { return }
            do {
                if let rebuilt = try wireEvents.rebuild(event) { sink.yield(.event(rebuilt)) }
            } catch {
                // A patch's failure is ours, not the desktop's: the link stays.
                warn("Couldn't take in what \(name) sent: \(error)")
            }
        case "denied":
            closed = true
            drop(frame.reason ?? "Relay said no.")
            setStatus(.denied, frame.reason)
        default: break
        }
    }

    func lost() {
        drop("Connection lost.")
        guard !closed, status.state != .denied else { return }
        setStatus(.offline, "Connection lost.")
        scheduleRetry()
    }

    func keepAlive(_ dial: Dial) {
        heard = .now
        watchdog?.cancel()
        watchdog = after(options.stale) { client in
            if client.current === dial { client.lost() }
        }
    }

    func sendFrame(_ frame: JSON) {
        guard let channel, let current else { return }
        current.socket?.send(sealFrame(channel, frame.text(), compact: (bridgeVersion ?? 0) >= Bridge.compact))
    }

    private func drop(_ reason: String) {
        watchdog?.cancel()
        betterTimer?.cancel()
        betterTimer = nil
        let dial = current
        current = nil
        channel = nil
        host = nil
        bridgeVersion = nil
        wireEvents.reset()
        tunnel.disconnect()
        tunnel.reset(reason)
        if let dial { quit(dial) }
        for call in calls.values {
            call.timer.cancel()
            call.result.resume(throwing: RemoteCallError.unanswered(reason))
        }
        calls = [:]
    }
}
