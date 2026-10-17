import Foundation
import RelayRemote

/// Updating the paired computer's Relay from the phone (Android's ComputerUpdates.kt): the
/// computer runs its own updater (bridge 11's `updateNow`) and restarts into the new version;
/// the phone watches until it comes back on one. Each look goes over whichever connection is
/// live then, so a restart's reconnect carries on watching.
@Observable
final class ComputerUpdates {
    private(set) var updates: [String: ComputerUpdate] = [:]
    /// Whether each computer can update itself; development builds can't. Unknown until probed.
    private(set) var selfUpdating: [String: Bool] = [:]
    /// The version a computer ran when its banner was waved off, for this launch.
    private(set) var dismissed: [String: String] = [:]
    @ObservationIgnored private var watching: [String: Task<Void, Never>] = [:]

    private static let watchEvery = Duration.seconds(2)
    private static let giveUpAfter: TimeInterval = 15 * 60

    private func set(_ computer: String, _ update: ComputerUpdate?) {
        updates[computer] = update
        if update?.underWay != true {
            watching.removeValue(forKey: computer)?.cancel()
        }
    }

    func start(_ computer: String, from running: String, _ connection: Connection) {
        if updates[computer]?.underWay == true { return }
        set(computer, .asking)
        Task {
            do {
                let state = UpdaterState(try await connection.liveClient().updateNow())
                set(computer, .settled(from: running, state))
            } catch {
                set(computer, .error(error.localizedDescription))
                return
            }
            if updates[computer]?.underWay == true { watch(computer, connection) }
        }
    }

    /// Asks how the update goes every few seconds while that computer is the one in use.
    private func watch(_ computer: String, _ connection: Connection) {
        watching[computer]?.cancel()
        let began = Date()
        watching[computer] = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.watchEvery)
                guard let self, case .updating(let from, _)? = self.updates[computer] else { continue }
                if Date().timeIntervalSince(began) > Self.giveUpAfter {
                    self.set(computer, .error("It hasn't come back on a new version. Check on it there."))
                    return
                }
                // Gone quiet while it restarts; the next connection says how it went.
                guard connection.active == computer, let client = try? connection.liveClient(),
                    let info = try? await client.computerInfo(), case .updating(from, _)? = self.updates[computer]
                else { continue }
                if info.version != from {
                    self.set(computer, nil)
                    // Its overview still says the old version until asked again.
                    await connection.reloadList()
                } else {
                    self.set(computer, .settled(from: from, UpdaterState(info.update)))
                }
            }
        }
    }

    /// The computer answered on this version: an update that got it there is over.
    func cameBack(_ computer: String, running: String?) {
        if case .updating(let from, _)? = updates[computer], let running, running != from { set(computer, nil) }
    }

    /// Hides the banner while the computer runs this version.
    func dismiss(_ computer: String, running: String?) {
        if let running { dismissed[computer] = running }
        set(computer, nil)
    }

    /// Asks once per launch whether the computer can update itself at all.
    func probe(_ computer: String, _ connection: Connection) async {
        guard selfUpdating[computer] == nil, let client = try? connection.liveClient(),
            let info = try? await client.computerInfo()
        else { return }
        selfUpdating[computer] = UpdaterState(info.update).status != "off"
    }
}

/// Whether the computer in use runs an older Relay than this phone, and what can be done from here.
struct ComputerUpdateAction {
    var update: ComputerUpdate?
    var needed: Bool
    /// Its bridge takes the phone's update call.
    var askable: Bool
    /// Updatable from here; a development build isn't.
    var can: Bool
    var devBuild: Bool
    var dismissed: Bool
    var hint: String
}

extension Connection {
    /// The computer in use's name as the phone shows it.
    var computerName: String { computer?.name ?? overview?.name ?? "your computer" }

    /// This app's own version.
    static var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }

    func updateAction(_ updates: ComputerUpdates) -> ComputerUpdateAction {
        let running = overview?.version
        let behind = running.map { newerVersion(Self.appVersion, $0) } ?? false
        let older = overview.map { ($0.bridge ?? 1) < Bridge.version } ?? false
        let needed = status.state == .online && (older || behind)
        let askable = (overview?.bridge ?? 1) >= Bridge.phoneUpdates
        let selfUpdating = active.flatMap { updates.selfUpdating[$0] }
        return ComputerUpdateAction(
            update: active.flatMap { updates.updates[$0] },
            needed: needed,
            askable: askable,
            can: needed && askable && selfUpdating == true,
            devBuild: needed && askable && selfUpdating == false,
            dismissed: active != nil && running != nil && updates.dismissed[active!] == running,
            hint: running.map { "\(computerName) runs Relay \($0), this phone \(Self.appVersion)." }
                ?? "\(computerName) runs an older Relay than this phone.")
    }

    func startUpdate(_ updates: ComputerUpdates) {
        guard let active, let running = overview?.version else { return }
        updates.start(active, from: running, self)
    }
}
