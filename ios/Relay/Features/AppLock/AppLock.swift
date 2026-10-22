import Foundation
import LocalAuthentication
import RelayRemote
import Security

/// Relay's own lock, over every computer paired here: the settings in the Keychain, and whether
/// the app is locked now. Read at once when built, so the first frame is already locked.
/// Android: `AppLock`.
@MainActor @Observable final class AppLock {
    private(set) var settings: LockSettings
    private(set) var locked: Bool
    /// Away with the lock on: the app switcher's snapshot shows the cover, not a thread.
    private(set) var covered = false
    /// Set when the lock screen should offer Face ID on its own; it clears it on taking it up.
    var wantsBiometrics = false

    @ObservationIgnored private var gate: LockGate
    @ObservationIgnored private let store = LockStore()
    @ObservationIgnored private let start = ContinuousClock.now

    init() {
        let settings = store.load()
        self.settings = settings
        gate = LockGate(on: settings.on)
        locked = gate.locked
    }

    func left() {
        gate.left(settings, now: clock)
        covered = settings.on
        sync()
    }

    func back() {
        gate.back(settings, now: clock)
        covered = false
        sync()
    }

    /// Checks `pin`, counting wrong ones; right, it unlocks. Settings ask this too before a change.
    func tryPin(_ pin: String) async -> Attempt {
        let now = wall
        let current = settings
        let stored = current.pin
        let matches = await Task.detached { current.waitUntil <= now && stored?.matches(pin) == true }.value
        let (next, result) = LockGate.attempt(current, matches: matches, now: now)
        if next != current { save(next) }
        if result == .unlocked { unlock() }
        return result
    }

    func unlockWithBiometrics() {
        if settings.failures != 0 {
            var next = settings
            next.failures = 0
            next.waitUntil = 0
            save(next)
        }
        unlock()
    }

    func turnOn(_ pin: String, biometrics: Bool) async {
        let stored = await Task.detached { StoredPin.of(pin) }.value
        save(LockSettings(pin: stored, biometrics: biometrics, after: settings.after))
    }

    func changePin(_ pin: String) async {
        let stored = await Task.detached { StoredPin.of(pin) }.value
        var next = settings
        next.pin = stored
        next.failures = 0
        next.waitUntil = 0
        save(next)
    }

    func turnOff() { save(LockSettings(after: settings.after)) }

    func useBiometrics(_ on: Bool) {
        var next = settings
        next.biometrics = on
        save(next)
    }

    func lockAfter(_ after: LockAfter) {
        var next = settings
        next.after = after
        save(next)
    }

    /// Forgot PIN: the lock goes, and the caller forgets every computer it guarded.
    func reset() {
        save(LockSettings())
        unlock()
    }

    private func unlock() {
        gate.unlock()
        sync()
    }

    private func sync() {
        if locked != gate.locked { locked = gate.locked }
    }

    private func save(_ next: LockSettings) {
        settings = next
        store.save(next)
    }

    /// Ms on a clock that keeps counting while the phone sleeps and ignores the time of day.
    private var clock: Int64 {
        let d = ContinuousClock.now - start
        return d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000
    }

    private var wall: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

/// The lock's settings as one Keychain item, beside the computers' and as private to this phone.
private struct LockStore {
    private let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "dev.relay.app-lock",
        kSecAttrAccount as String: "settings",
    ]

    func load() -> LockSettings {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return LockSettings() }
        return (try? JSONDecoder().decode(LockSettings.self, from: data)) ?? LockSettings()
    }

    func save(_ settings: LockSettings) {
        guard settings.on, let data = try? JSONEncoder().encode(settings) else {
            SecItemDelete(query as CFDictionary)
            return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
        }
    }
}

/// The phone's Face ID or Touch ID. It only stands in for typing the PIN; it unlocks no key.
enum Biometrics {
    static var available: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    /// "Use Face ID", "Use Touch ID", as Android takes the system's words for it.
    static var label: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return switch context.biometryType {
        case .touchID: "Use Touch ID"
        case .opticID: "Use Optic ID"
        default: "Use Face ID"
        }
    }

    static var symbol: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return switch context.biometryType {
        case .touchID: "touchid"
        case .opticID: "opticid"
        default: "faceid"
        }
    }

    /// True once recognised, false when given up or cancelled.
    static func prompt() async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Use PIN"
        return (try? await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Unlock Relay")) ?? false
    }
}
