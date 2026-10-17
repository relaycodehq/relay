import SwiftUI
import UIKit

extension View {
    /// Tells SwiftUI a minimized search was closed. On iOS 27 its ✕ closes the field in UIKit
    /// alone: SwiftUI still has it open and opens it again, the old text back in it, or leaves
    /// an empty capsule nothing can be typed into. `closed` should set `isPresented` to false.
    func onSearchClosed(_ closed: @escaping () -> Void) -> some View {
        background(SearchClosedHook(closed: closed))
    }
}

private struct SearchClosedHook: UIViewControllerRepresentable {
    let closed: () -> Void

    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.closed = closed
    }

    final class Controller: UIViewController {
        var closed: () -> Void = {}
        private var watching: NSObjectProtocol?

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard watching == nil,
                let search = sequence(first: self as UIViewController, next: \.parent)
                    .lazy.compactMap(\.navigationItem.searchController).first
            else { return }
            // The field stops editing as the search closes; the keyboard put away alone leaves
            // the search active.
            watching = NotificationCenter.default.addObserver(
                forName: UITextField.textDidEndEditingNotification, object: search.searchBar.searchTextField,
                queue: .main
            ) { [weak self, weak search] _ in
                MainActor.assumeIsolated {
                    if search?.isActive == false { self?.closed() }
                }
            }
        }

        isolated deinit {
            if let watching { NotificationCenter.default.removeObserver(watching) }
        }
    }
}
