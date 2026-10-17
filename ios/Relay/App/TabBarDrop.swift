import SwiftUI
import UIKit

/// Drops the tab bar below the screen as a screen is pushed over a tab's root, and lifts it
/// back as that screen leaves. It rides the navigation transition, so a slow swipe back lifts
/// it as far as the finger has gone, and a swipe let go of drops it again. Pushed screens
/// take back the room the bar leaves with `overTabBar()`.
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
            // Hosted some ways, the root hears it's back only once a swipe has finished, too late to
            // follow it; heard twice, the move is the same.
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
                let tabBar = nav.tabBarController?.tabBar
            else { return }
            // The bar's glass is drawn by the group around it: moving the bar alone shows nothing.
            let bar = sequence(first: tabBar as UIView, next: \.superview).first {
                String(describing: type(of: $0)).contains("TabBarGroup")
            } ?? tabBar
            let home = view.window?.safeAreaInsets.bottom ?? 34
            // Through its bounds rather than its transform, which the tab bar animates itself.
            let down = -(tabBar.frame.height + home + 12)
            let place = { (y: CGFloat) in
                bar.bounds.origin.y = y
                // Its frame stays where it was: down, it would take the touches meant for the screen.
                bar.isUserInteractionEnabled = y == 0
            }
            guard let coordinator = nav.transitionCoordinator else {
                place(nav.topViewController === root ? 0 : down)
                return
            }
            let toRoot = coordinator.viewController(forKey: .to) === root
            let fromRoot = coordinator.viewController(forKey: .from) === root
            // A swipe let go of tells the root it's leaving again, on the same transition.
            guard toRoot != fromRoot, !coordinator.isCancelled else { return }
            // Where it was, whoever moved it: this may run twice for one swipe.
            let before = toRoot ? down : 0
            bar.isUserInteractionEnabled = false
            let target = toRoot ? 0 : down
            guard coordinator.isInteractive else {
                // A tap's push runs on the clock from its start, and building the new screen holds
                // the first frames back: along with it, the bar would be found at its end. On its
                // own, the bar's slide starts with the first frame drawn.
                UIView.animate(springDuration: coordinator.transitionDuration, bounce: 0) {
                    bar.bounds.origin.y = target
                } completion: { _ in
                    place(target)
                }
                return
            }
            // A swipe's along with it, so the bar follows the finger.
            coordinator.animate { _ in
                bar.bounds.origin.y = target
            } completion: { context in
                place(context.isCancelled ? before : target)
            }
        }
    }
}

extension View {
    /// Lays a pushed screen out to the bottom edge, its bars as low as the tab bar sat:
    /// the tab bar it drops still counts in the inset, which UIKit won't take a negative
    /// inset against. With the keyboard up, the keyboard's own inset stands.
    func overTabBar() -> some View { modifier(OverTabBar()) }
}

private struct OverTabBar: ViewModifier {
    @State private var keyboard: CGFloat = 0

    func body(content: Content) -> some View {
        let home = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?
            .safeAreaInsets.bottom ?? 34
        content
            // As low as the tab bar it takes over, which floats 12pt into the home indicator's
            // room; the bars along the bottom keep 6pt of their own.
            .safeAreaPadding(.bottom, keyboard > 0 ? 0 : max(home - 18, 2))
            // Outside the padding, so it reads the keyboard alone.
            .background {
                Color.clear.onGeometryChange(for: CGFloat.self, of: { $0.safeAreaInsets.bottom }) { keyboard = $0 }
            }
            .ignoresSafeArea(.container, edges: .bottom)
    }
}
