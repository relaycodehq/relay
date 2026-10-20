import SwiftUI
import UIKit

/// The lock in a window of its own above the app's, so it covers sheets, alerts and full-screen
/// covers alike without each of them knowing. Hidden while unlocked; away with the lock on, it
/// shows a plain cover, which is what the app switcher's snapshot gets. Android: `LockWindow`.
@MainActor final class LockPresenter {
    private let lock: AppLock
    private let connection: Connection
    private var window: UIWindow?
    /// The app's window, key again once the lock hides.
    private weak var below: UIWindow?
    /// Face ID offered for this locking already.
    private var asked = false
    private var observers: [NSObjectProtocol] = []

    init(lock: AppLock, connection: Connection) {
        self.lock = lock
        self.connection = connection
    }

    func install() {
        guard window == nil,
              let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene
        else { return }
        let host = UIHostingController(rootView: LockRoot(lock: lock, hide: { [weak self] in self?.hide() })
            .relayTheme()
            .environment(connection))
        host.view.backgroundColor = .clear
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = host
        window.isHidden = true
        // VoiceOver skips the app's windows below while this one shows, as it does under an alert.
        window.accessibilityViewIsModal = true
        self.window = window

        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIScene.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.left() }
            },
            center.addObserver(forName: UIScene.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.back() }
            },
            center.addObserver(forName: UIScene.didActivateNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.active() }
            },
        ]
        if lock.locked { show() }
        if UIApplication.shared.applicationState == .active { active() }
    }

    private func left() {
        lock.left()
        // Now rather than on the next SwiftUI pass: the snapshot is taken as this returns.
        if lock.locked || lock.covered { show() }
    }

    private func back() {
        lock.back()
        if lock.locked { show() } else { hide() }
    }

    private func active() {
        guard lock.locked, !asked else { return }
        asked = true
        lock.wantsBiometrics = true
    }

    private func show() {
        guard let window, window.isHidden else { return }
        if lock.locked {
            asked = false
            lock.wantsBiometrics = false
            // The keyboard's window sits above every other; it would type into the thread below.
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
        // Key, so VoiceOver and the keyboard are on the lock rather than the app under it.
        below = window.windowScene?.keyWindow
        window.makeKeyAndVisible()
        window.layoutIfNeeded()
    }

    private func hide() {
        guard !lock.locked, !lock.covered else { return }
        guard let window, !window.isHidden else { return }
        window.isHidden = true
        below?.makeKey()
    }
}

/// What the window draws: the lock screen while locked, fading and growing away once unlocked;
/// otherwise the cover.
private struct LockRoot: View {
    let lock: AppLock
    let hide: () -> Void
    @State private var fade = 1.0
    @State private var leaving = false
    @Environment(\.colors) private var colors

    var body: some View {
        ZStack {
            if lock.locked || leaving {
                LockScreen(lock: lock)
                    .opacity(fade)
                    .scaleEffect(1 + (1 - fade) * 0.06)
            } else {
                Cover()
            }
        }
        .onChange(of: lock.locked) { _, locked in
            guard !locked else { return }
            leaving = true
            withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.28)) {
                fade = 0
            } completion: {
                hide()
                leaving = false
                fade = 1
            }
        }
    }
}

private struct Cover: View {
    @Environment(\.colors) private var colors

    var body: some View {
        Image("RelayMark")
            .resizable()
            .scaledToFit()
            .frame(width: 64, height: 64)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { colors.background.ignoresSafeArea() }
            .accessibilityHidden(true)
    }
}
