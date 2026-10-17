import SwiftUI
import UIKit

/// Drops the tab bar below the screen as a screen is pushed over the tabs, and lifts it back
/// as that screen leaves. It rides the navigation transition, so a slow swipe back lifts it
/// as far as the finger has gone, and a swipe let go of drops it again.
struct TabBarDrop: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {}

    final class Controller: UIViewController {
        private weak var watched: UINavigationController?

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            move()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            move()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            // The tabs hear they're back only once a swipe back has finished, too late to follow it.
            guard let nav = navigationController, nav !== watched else { return }
            watched = nav
            nav.interactivePopGestureRecognizer?.addTarget(self, action: #selector(swiped))
            nav.interactiveContentPopGestureRecognizer?.addTarget(self, action: #selector(swiped))
        }

        @objc private func swiped(_ gesture: UIGestureRecognizer) {
            // The swipe's transition starts in UIKit's own handler, which may come after this one.
            if gesture.state == .began { DispatchQueue.main.async { self.move() } }
        }

        /// Down while the tabs are covered, up as they come back, along with the transition there is.
        private func move() {
            guard let nav = navigationController, let root = nav.viewControllers.first,
                let bar = tabBar(in: root.view)
            else { return }
            // Through its bounds rather than its transform, which the tab bar animates itself.
            let down = -(bar.frame.height + (view.window?.safeAreaInsets.bottom ?? 34) + 12)
            guard let coordinator = nav.transitionCoordinator else {
                bar.bounds.origin.y = nav.topViewController === root ? 0 : down
                return
            }
            let toRoot = coordinator.viewController(forKey: .to) === root
            let fromRoot = coordinator.viewController(forKey: .from) === root
            guard toRoot != fromRoot else { return }
            let before = bar.bounds.origin.y
            coordinator.animate { _ in
                bar.bounds.origin.y = toRoot ? 0 : down
            } completion: { context in
                if context.isCancelled { bar.bounds.origin.y = before }
            }
        }

        private func tabBar(in view: UIView?) -> UITabBar? {
            guard let view else { return nil }
            if let bar = view as? UITabBar { return bar }
            for sub in view.subviews { if let bar = tabBar(in: sub) { return bar } }
            return nil
        }
    }
}

