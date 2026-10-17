import SwiftUI

extension View {
    /// Pull to refresh that writes the Relay R, in place of `.refreshable`'s spinner, as Android's
    /// RibbonRefreshBox: pulling the list down opens a gap and writes the R into it stroke by
    /// stroke, finishing exactly where letting go refreshes (with a tick and a glint). While it
    /// loads, light runs along the satin; when it's done the gap closes and the R rolls back up
    /// the way it was written.
    func ribbonRefresh(_ action: @escaping () async -> Void) -> some View {
        modifier(RibbonRefresh(action: action))
    }
}

/// How far a list is pulled down past its top, and where its content starts under the bars.
private struct Overscroll: Equatable {
    var pull: Double
    var top: Double
}

private struct RibbonRefresh: ViewModifier {
    let action: () async -> Void
    @Environment(\.colors) private var colors
    @Environment(\.accessibilityReduceMotion) private var reduced
    @State private var scroll = Overscroll(pull: 0, top: 0)
    @State private var dragging = false
    /// The pull is still the finger's: dragging, or springing back from where it was let go.
    @State private var pulled = false
    /// The gap kept open while it refreshes; it closes to 0 after, which rolls the R back up.
    @State private var hold = 0.0
    @State private var refreshing = false
    @State private var arms = 0
    @State private var armed = false
    @State private var flashing = false
    @State private var armedAt = Date.distantPast
    @State private var loadingSince = Date.distantPast

    func body(content: Content) -> some View {
        let shown = pulled ? scroll.pull : 0
        content
            // Once let go, the list's own bounce falls back to its top; this keeps the gap open
            // under it, so the list settles at the gap instead of jumping there.
            .offset(y: max(0, hold - scroll.pull))
            .onScrollGeometryChange(for: Overscroll.self) { g in
                Overscroll(pull: max(0, -(g.contentOffset.y + g.contentInsets.top)), top: g.contentInsets.top)
            } action: { _, now in
                scroll = now
                guard dragging, !refreshing else { return }
                if now.pull >= gap, !armed {
                    armed = true
                    arms += 1
                    flash()
                } else if now.pull < gap * 0.9 {
                    armed = false
                }
            }
            .onScrollPhaseChange { old, new in
                dragging = new == .interacting
                if new == .interacting { pulled = true }
                if old == .interacting, new != .interacting {
                    pulled = scroll.pull > 0
                    if scroll.pull >= gap { refresh() }
                }
                if new == .idle { pulled = false }
            }
            .overlay(alignment: .top) {
                RibbonGap(
                    open: max(shown, hold), refreshing: refreshing, flashing: flashing, armedAt: armedAt,
                    loadingSince: loadingSince, reduced: reduced, onWhite: !colors.dark
                )
                .padding(.top, scroll.top)
                .allowsHitTesting(false)
                // The insets already count the bars; laid out inside them it came down twice as far.
                .ignoresSafeArea(.container, edges: .top)
            }
            .sensoryFeedback(.impact(weight: .light), trigger: arms)
    }

    private func flash() {
        guard !reduced else { return }
        armedAt = .now
        flashing = true
        Task {
            try? await Task.sleep(for: .seconds(flashTime))
            flashing = false
        }
    }

    private func refresh() {
        guard !refreshing else { return }
        refreshing = true
        hold = gap
        loadingSince = .now
        Task {
            await action()
            refreshing = false
            armed = false
            withAnimation(.smooth(duration: 0.4)) { hold = 0 }
        }
    }
}

/// The gap above a pulled list, with as much of the R written into it as it is open.
private struct RibbonGap: View, Animatable {
    var open: Double
    let refreshing: Bool
    let flashing: Bool
    let armedAt: Date
    let loadingSince: Date
    let reduced: Bool
    let onWhite: Bool

    var animatableData: Double {
        get { open }
        set { open = newValue }
    }

    var body: some View {
        if open >= 0.5 {
            TimelineView(.animation(paused: !(refreshing && !reduced) && !flashing)) { timeline in
                Canvas { context, size in
                    let p = min(max(open / gap, 0), 1)
                    let (glintAt, glint) = glint(at: timeline.date)
                    RibbonMesh.draw(
                        in: context, center: CGPoint(x: size.width / 2, y: open / 2), height: rHeight,
                        written: p * p * (3 - 2 * p), glintAt: glintAt, glint: glint, onWhite: onWhite)
                }
            }
            .frame(height: open)
            .clipped()
        }
    }

    private func glint(at now: Date) -> (Double, Double) {
        if refreshing {
            guard !reduced else { return (0, 0) }
            let x = (now.timeIntervalSince(loadingSince) * 0.75).truncatingRemainder(dividingBy: 1.25) / 1.25
            return (-0.15 + 1.5 * x, 0.9)
        }
        let x = now.timeIntervalSince(armedAt) / flashTime
        guard flashing, (0...1).contains(x) else { return (0, 0) }
        return (-0.15 + 1.3 * x, sin(.pi * x))
    }
}

private let gap = 88.0
private let rHeight = 54.0
private let flashTime = 0.38
