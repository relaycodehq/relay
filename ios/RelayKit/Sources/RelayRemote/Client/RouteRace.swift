import Foundation

struct RaceHandlers {
    var stale: () -> Bool
    var claim: (Race, Link) -> Bool
    var failed: (Race, DialError) -> Void = { _, _ in }
    var done: (Race) -> Void
}

/// One race over a list of routes. Touched only on its client's executor.
final class Race: @unchecked Sendable {
    let endpoint: Endpoint
    let serverKey: Data
    let pairing: Bool
    let order: [String]
    let on: RaceHandlers
    var mine: [ObjectIdentifier: Dial] = [:]
    var next = 0
    var won = false
    var signing: Dial?
    var timer: Task<Void, Never>?
    /// Why the last route failed, for the status once all have; a blocked route's reason sticks.
    var reason: String?
    var blocked = false
    /// A route signed in but wasn't taken, since calls were waiting on the old one.
    var busy = false

    init(endpoint: Endpoint, serverKey: Data, pairing: Bool, order: [String], on: RaceHandlers) {
        self.endpoint = endpoint
        self.serverKey = serverKey
        self.pairing = pairing
        self.order = order
        self.on = on
    }
}

extension RemoteClient {
    var racing: Bool { !raceDials.isEmpty }

    func cancelRaces() {
        for dial in raceDials.values {
            cancel(dial)
            settle(dial.race)
        }
        raceDials = [:]
    }

    /// Dials the hosts in order, each a little after the one before unless that
    /// one already failed, and keeps the first that signs in. A pairing code
    /// works once, so when pairing, the first channel to open alone sends it.
    func race(_ endpoint: Endpoint, pairing: Bool, order: [String], _ on: RaceHandlers) {
        let serverKey = Base64URL.decode(endpoint.key)
        let race = Race(endpoint: endpoint, serverKey: serverKey ?? Data(), pairing: pairing, order: order, on: on)
        guard serverKey?.count == 32 else {
            on.failed(race, .failed("Couldn't verify \(name). Pair again."))
            return on.done(race)
        }
        if order.isEmpty { on.done(race) } else { dialNext(race) }
    }

    private func forget(_ dial: Dial) {
        dial.race.mine.removeValue(forKey: ObjectIdentifier(dial))
        raceDials.removeValue(forKey: ObjectIdentifier(dial))
    }

    /// Ends the race; its dials hold it, so it lets go of them too.
    private func settle(_ race: Race) {
        race.timer?.cancel()
        race.timer = nil
        for dial in race.mine.values {
            cancel(dial)
            raceDials.removeValue(forKey: ObjectIdentifier(dial))
        }
        race.mine = [:]
        race.signing = nil
    }

    private func dialNext(_ race: Race) {
        race.timer?.cancel()
        guard !race.won, race.signing == nil, !race.on.stale(), race.next < race.order.count else { return }
        let host = race.order[race.next]
        race.next += 1
        let dial = openDial(host, port: race.endpoint.port, serverKey: race.serverKey, race: race)
        race.mine[ObjectIdentifier(dial)] = dial
        raceDials[ObjectIdentifier(dial)] = dial
        if race.next < race.order.count {
            race.timer = after(options.stagger) { $0.dialNext(race) }
        }
    }

    /// The channel is open; false leaves this route before it signs in.
    func dialSignIn(_ dial: Dial) -> Bool {
        let race = dial.race
        guard race.pairing else { return true }
        if race.won || race.signing != nil || race.on.stale() { return false }
        race.signing = dial
        race.timer?.cancel()
        for other in race.mine.values where other !== dial {
            cancel(other)
            forget(other)
        }
        return true
    }

    func dialClaim(_ dial: Dial, _ link: Link) -> Bool {
        let race = dial.race
        forget(dial)
        if race.won || race.on.stale() || !race.on.claim(race, link) { return false }
        race.won = true
        settle(race)
        return true
    }

    func dialFailed(_ dial: Dial, _ error: DialError) {
        let race = dial.race
        forget(dial)
        if race.signing === dial { race.signing = nil }
        if race.won || race.on.stale() { return }
        race.on.failed(race, error)
        // A refusal from the pinned desktop holds for every route.
        if case .denied = error { return settle(race) }
        if race.next < race.order.count {
            dialNext(race)
        } else if race.mine.isEmpty {
            race.on.done(race)
        }
    }
}
