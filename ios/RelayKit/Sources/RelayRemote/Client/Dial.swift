import Foundation

enum DialState {
    case dialing
    case won
    case done
}

struct Endpoint {
    var hosts: [String]
    var port: Int
    var key: String
}

struct Link {
    let dial: Dial
    let channel: Channel
    let host: String
    let frame: ServerFrame
}

/// One route: connects, opens the channel under the pinned key and signs in.
/// Touched only on its client's executor; that's what makes it Sendable.
final class Dial: @unchecked Sendable {
    let host: String
    let handshake: ClientHandshake
    let race: Race
    var socket: RemoteSocket?
    var channel: Channel?
    var state = DialState.dialing
    var detached = false
    var timer: Task<Void, Never>?
    /// iOS held this route back for local network access.
    var blocked = false

    init(host: String, serverKey: Data, race: Race) {
        self.host = host
        handshake = ClientHandshake(serverKey: serverKey)
        self.race = race
    }
}

/// The first frame on a fresh channel: the pairing code, or the saved device's token.
func signInFrame(_ target: RemoteStart) -> JSON {
    switch target {
    case .pair(let link, let device, let kind):
        var frame: [String: JSON] = [
            "t": "pair", "code": .string(link.code), "device": .string(device), "bridge": .number(Double(Bridge.version)),
        ]
        if let kind { frame["kind"] = .string(kind) }
        return .object(frame)
    case .saved(let c):
        return [
            "t": "auth", "deviceId": .string(c.deviceId), "token": .string(c.token),
            "bridge": .number(Double(Bridge.version)),
        ]
    }
}

extension RemoteClient {
    func openDial(_ host: String, port: Int, serverKey: Data, race: Race) -> Dial {
        let dial = Dial(host: host, serverKey: serverKey, race: race)
        dial.timer = after(options.timeout) { client in
            client.fail(
                dial,
                dial.blocked
                    ? .blocked("This phone keeps Relay off the local network. Turn on Settings › Privacy & Security › Local Network › Relay.")
                    : .failed("\(host) didn't answer."))
        }
        let bracketed = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        // Hosts are validated names or bracketed IPv6, so this always parses.
        let url = URL(string: "ws://\(bracketed):\(port)/")!
        dial.socket = sockets.open(url: url, queue: queue) { [weak self, weak dial] event in
            guard let self, let dial else { return }
            self.assumeIsolated { client in
                guard !dial.detached else { return }
                switch event {
                case .open: dial.socket?.send(.text(dial.handshake.hello))
                case .message(let data): client.dialMessage(dial, data)
                case .blocked: dial.blocked = true
                case .closed: client.dialClosed(dial)
                }
            }
        }
        return dial
    }

    func quit(_ dial: Dial) {
        dial.detached = true
        dial.timer?.cancel()
        dial.socket?.cancel()
    }

    func cancel(_ dial: Dial) {
        guard dial.state == .dialing else { return }
        dial.state = .done
        quit(dial)
    }

    func fail(_ dial: Dial, _ error: DialError) {
        guard dial.state == .dialing else { return }
        dial.state = .done
        quit(dial)
        dialFailed(dial, error)
    }

    private func dialClosed(_ dial: Dial) {
        if dial.state == .dialing { return fail(dial, .failed("Can't reach \(name).")) }
        if dial.state == .won, current === dial { lost() }
    }

    private func dialMessage(_ dial: Dial, _ data: WireData) {
        let frame: ServerFrame
        do {
            guard let open = dial.channel else {
                guard case .text(let hello) = data else { throw ChannelError(description: "A binary hello.") }
                let ready = try dial.handshake.finish(hello)
                dial.channel = ready
                guard dialSignIn(dial) else {
                    dial.state = .done
                    return quit(dial)
                }
                // Sealed whole: nothing compact before the desktop says it reads it.
                dial.socket?.send(sealFrame(ready, signInFrame(target).text(), compact: false))
                return
            }
            let opened = try openWire(open, data)
            guard case .json(let text) = opened else {
                if case .tunnel(let frame) = opened, dial.state == .won, current === dial {
                    keepAlive(dial)
                    tunnel.receive(frame)
                }
                return
            }
            let parsed = try ServerFrame(JSON.parse(text))
            if dial.state == .dialing {
                if parsed.t == "denied" { return fail(dial, .denied(parsed.reason ?? "Relay said no.")) }
                guard parsed.t == "paired" || parsed.t == "ready" else {
                    return fail(dial, .failed("Unexpected answer from Relay."))
                }
                dial.timer?.cancel()
                guard dialClaim(dial, Link(dial: dial, channel: open, host: dial.host, frame: parsed)) else {
                    dial.state = .done
                    return quit(dial)
                }
                dial.state = .won
                return
            }
            guard dial.state == .won else { return }
            keepAlive(dial)
            frame = parsed
        } catch {
            // Anything that doesn't open under the pinned key isn't our desktop.
            if dial.state == .dialing { return fail(dial, .failed("Couldn't verify \(name). Pair again.")) }
            if current === dial { lost() } else { quit(dial) }
            return
        }
        receive(frame)
    }
}
