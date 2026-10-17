import AVFoundation
import Network
import UIKit

/// What scanning needs, asked for on the tap, before the field moves: the system's prompts would
/// otherwise come up over the fold, or over the lock-on once pairing first reaches the network.
enum ScanPermissions {
    private static let localNetworkKey = "relay.local-network-allowed"

    /// False when the camera's refused.
    static func camera() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .video)
        default: false
        }
    }

    /// Brings up the local network prompt if it hasn't been answered, and waits for the answer.
    /// A refusal doesn't stop the scan: a computer reached over Tailscale or the internet doesn't need it.
    static func localNetwork() async {
        if UserDefaults.standard.bool(forKey: localNetworkKey) { return }
        let probe = LocalNetworkProbe()
        probe.start()
        // The prompt makes the app inactive while it's up; once it's been active a moment with
        // no answer, there's nothing to wait for (no network to find ourselves on, say).
        var quiet = 0.0
        while probe.answer == nil, quiet < 1.5 {
            try? await Task.sleep(for: .milliseconds(100))
            quiet = UIApplication.shared.applicationState == .active ? quiet + 0.1 : 0
        }
        probe.stop()
        if probe.answer == true { UserDefaults.standard.set(true, forKey: localNetworkKey) }
    }
}

/// iOS has no call that asks for the local network or says whether it's allowed (TN3179):
/// advertising a Bonjour service and browsing for it asks, finding it says yes, and the browser
/// stalling on a policy refusal says no.
private nonisolated final class LocalNetworkProbe: @unchecked Sendable {
    private static let type = "_relay-probe._tcp"
    /// kDNSServiceErr_PolicyDenied.
    private static let refused: Int32 = -65570
    private let queue = DispatchQueue(label: "relay.local-network-probe")
    private let lock = NSLock()
    private var listener: NWListener?
    private var browser: NWBrowser?
    private var answered: Bool?

    var answer: Bool? { lock.withLock { answered } }

    func start() {
        guard let listener = try? NWListener(using: .tcp) else { return settle(false) }
        listener.service = NWListener.Service(name: UUID().uuidString, type: Self.type)
        listener.newConnectionHandler = { $0.cancel() }
        listener.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.settle(false) }
        }
        let browser = NWBrowser(for: .bonjour(type: Self.type, domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            if !results.isEmpty { self?.settle(true) }
        }
        browser.stateUpdateHandler = { [weak self] state in
            switch state {
            case .waiting(.dns(let code)) where code == Self.refused: self?.settle(false)
            case .failed: self?.settle(false)
            default: break
            }
        }
        self.listener = listener
        self.browser = browser
        listener.start(queue: queue)
        browser.start(queue: queue)
    }

    func stop() {
        browser?.cancel()
        listener?.cancel()
    }

    private func settle(_ allowed: Bool) {
        lock.withLock { if answered == nil { answered = allowed } }
    }
}
