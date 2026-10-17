import SwiftUI

extension View {
    /// Draws the views under it afresh each time InjectionLite loads an edited file into the app
    /// running in the Simulator (ios/AGENTS.md, "Hot reload"). Their state starts over; what
    /// lives above it, like each tab's stack of screens, stays. Nothing in a Release build.
    func hotReloads() -> some View {
        #if DEBUG
        modifier(HotReloads())
        #else
        self
        #endif
    }
}

#if DEBUG
private struct HotReloads: ViewModifier {
    @State private var loads = 0

    func body(content: Content) -> some View {
        content
            .id(loads)
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("INJECTION_BUNDLE_NOTIFICATION"))) { _ in
                loads += 1
            }
    }
}
#endif
