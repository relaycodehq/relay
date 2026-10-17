import Foundation

// Updating the paired computer's Relay from the phone (Android's ComputerUpdates.kt): the
// computer runs its own updater and restarts into the new version.

/// shared/updates' UpdateState, read loosely: the computer's updater as it reports itself.
public struct UpdaterState: Equatable, Sendable {
    /// "off" | "idle" | "checking" | "available" | "downloading" | "ready" | "waiting" | "installing" | "error"
    public var status: String
    public var version: String?
    public var progress: Double
    /// "auto" | "manual", when one is available.
    public var install: String?
    public var reason: String?
    public var message: String?

    public init(
        status: String, version: String? = nil, progress: Double = 0, install: String? = nil, reason: String? = nil,
        message: String? = nil
    ) {
        self.status = status
        self.version = version
        self.progress = progress
        self.install = install
        self.reason = reason
        self.message = message
    }

    public init(_ json: JSON?) {
        guard let o = json?.object else {
            self.init(status: "off")
            return
        }
        self.init(
            status: o["status"]?.string ?? "off", version: o["version"]?.string, progress: o["progress"]?.number ?? 0,
            install: o["install"]?.string, reason: o["reason"]?.string, message: o["message"]?.string)
    }
}

public enum ComputerUpdate: Equatable, Sendable {
    case asking
    /// `from` is the version it ran when asked.
    case updating(from: String, state: UpdaterState)
    /// Its updater found nothing newer than what it runs.
    case latest
    case error(String)

    public var underWay: Bool {
        switch self {
        case .asking, .updating: true
        case .latest, .error: false
        }
    }

    /// What the updater's answer makes of an update asked from `from`.
    public static func settled(from: String, _ state: UpdaterState) -> ComputerUpdate {
        switch state.status {
        case "error": .error(state.message ?? "Its updater failed.")
        case "idle", "off": .latest
        case "available" where state.install == "manual":
            .error(state.reason ?? "Relay \(state.version ?? "") has to be installed there by hand.")
        default: .updating(from: from, state: state)
        }
    }
}

/// Its update, in a few words.
public func describeUpdate(_ name: String, _ update: ComputerUpdate) -> String {
    switch update {
    case .asking: return "Asking \(name) to update…"
    case .latest: return "\(name) has the latest Relay already."
    case .error(let m):
        let sentence = m.isEmpty || ".!?".contains(m.last!) ? m : "\(m)."
        return "Couldn't update \(name): \(sentence)"
    case .updating(_, let s):
        switch s.status {
        case "checking": return "\(name) is looking for a new Relay…"
        case "downloading": return "\(name) is downloading Relay \(s.version ?? "")… \(Int((s.progress * 100).rounded()))%"
        case "waiting": return "\(name) restarts into Relay \(s.version ?? "") once its background work finishes."
        default:
            if let v = s.version, !v.isEmpty { return "\(name) is restarting into Relay \(v)…" }
            return "Updating \(name)…"
        }
    }
}

public extension RemoteClient {
    /// shared/updates' UpdateState, raw. From `Bridge.phoneUpdates`.
    func updateNow() async throws -> JSON {
        try await call("updateNow")
    }
}

/// shared/phone-app.ts: what this app runs, for the desktop's Settings → Phone. An iPhone's
/// code only ever comes with the app, so it's never "updated" and never fetches one.
public struct PhoneAppReport: Codable, Sendable, Equatable {
    public var version: String
    public var updated = false
    /// The version the app was installed with; the same here.
    public var apk: String
    public var updates = false

    public init(version: String) {
        self.version = version
        apk = version
    }
}

public extension RemoteClient {
    /// Older desktops don't take it.
    func reportApp(_ report: PhoneAppReport) async throws {
        _ = try await call("reportApp", [try JSON(encoding: report)])
    }
}
