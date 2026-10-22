import Foundation

/// How long Relay may be away before it asks for the PIN again. Android: `LockAfter`.
public enum LockAfter: String, Codable, CaseIterable, Sendable {
    case immediately, oneMinute, fiveMinutes, fifteenMinutes, oneHour

    public var ms: Int64 {
        switch self {
        case .immediately: 0
        case .oneMinute: 60_000
        case .fiveMinutes: 5 * 60_000
        case .fifteenMinutes: 15 * 60_000
        case .oneHour: 60 * 60_000
        }
    }

    public var label: String {
        switch self {
        case .immediately: "Right away"
        case .oneMinute: "After 1 minute"
        case .fiveMinutes: "After 5 minutes"
        case .fifteenMinutes: "After 15 minutes"
        case .oneHour: "After 1 hour"
        }
    }
}

/// The lock as kept in the Keychain: no PIN means no lock.
public struct LockSettings: Codable, Equatable, Sendable {
    public var pin: StoredPin?
    public var biometrics = false
    public var after = LockAfter.immediately
    /// Wrong PINs in a row, kept across restarts so killing the app doesn't reset the wait.
    public var failures = 0
    /// Wall-clock ms before which no PIN is tried.
    public var waitUntil: Int64 = 0

    public var on: Bool { pin != nil }

    public init(pin: StoredPin? = nil, biometrics: Bool = false, after: LockAfter = .immediately, failures: Int = 0, waitUntil: Int64 = 0) {
        self.pin = pin
        self.biometrics = biometrics
        self.after = after
        self.failures = failures
        self.waitUntil = waitUntil
    }
}

public enum Attempt: Equatable, Sendable {
    case unlocked
    case wrong(failures: Int, waitMs: Int64)
    case waiting(leftMs: Int64)
}

public enum LockWords {
    public static let pinLength = 6

    /// Wrong PINs before each further one makes the next try wait.
    public static let freeTries = 5

    public static func waitAfter(_ failures: Int) -> Int64 {
        switch failures {
        case ..<freeTries: 0
        case freeTries: 30_000
        case freeTries + 1: 60_000
        case freeTries + 2: 5 * 60_000
        case freeTries + 3: 15 * 60_000
        default: 60 * 60_000
        }
    }

    public static func waitLine(_ leftMs: Int64) -> String {
        let s = max((leftMs + 999) / 1000, 1)
        return s < 60 ? "Too many tries. Try again in \(s)s" : "Too many tries. Try again in \((s + 59) / 60) min"
    }

    public static func wrongLine(_ failures: Int) -> String {
        failures == freeTries - 1 ? "Wrong PIN. One more and Relay makes you wait." : "Wrong PIN"
    }
}

/// When Relay locks, in memory and on a monotonic clock: a cold start is locked, leaving starts
/// the clock, coming back past `LockSettings.after` locks. A trip Relay sent the reader on itself
/// (a photo picker, the camera) doesn't count, unless it lasts past `ownTripMs`.
public struct LockGate: Sendable {
    public static let ownTripMs: Int64 = 10 * 60_000

    public private(set) var locked: Bool
    private var awaySince: Int64?
    private var ownTripAt: Int64?

    public init(on: Bool) { locked = on }

    public mutating func lock() { locked = true }
    public mutating func unlock() { locked = false }
    public mutating func ownTrip(now: Int64) { ownTripAt = now }

    public mutating func left(_ settings: LockSettings, now: Int64) {
        guard settings.on else { return }
        awaySince = now
        if settings.after == .immediately && ownTripAt == nil { locked = true }
    }

    public mutating func back(_ settings: LockSettings, now: Int64) {
        guard let since = awaySince else { return }
        let trip = ownTripAt
        awaySince = nil
        ownTripAt = nil
        guard settings.on, !locked else { return }
        if let trip, now - trip < Self.ownTripMs { return }
        if now - since >= settings.after.ms { locked = true }
    }

    /// A PIN tried at wall time `now`: the settings to keep and what happened.
    public static func attempt(_ settings: LockSettings, matches: Bool, now: Int64) -> (LockSettings, Attempt) {
        if settings.waitUntil > now { return (settings, .waiting(leftMs: settings.waitUntil - now)) }
        var next = settings
        if matches {
            next.failures = 0
            next.waitUntil = 0
            return (next, .unlocked)
        }
        next.failures += 1
        let wait = LockWords.waitAfter(next.failures)
        next.waitUntil = wait > 0 ? now + wait : 0
        return (next, .wrong(failures: next.failures, waitMs: wait))
    }
}
