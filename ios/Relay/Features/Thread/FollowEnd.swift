import SwiftUI

extension View {
    /// Keeps a thread's scroll view at its end while it should be there; `jump` scrolls to a message.
    func followingEnd(live: Bool, last: String?, mine: Bool, jump: MessageJump? = nil) -> some View {
        modifier(FollowEnd(live: live, last: last, mine: mine, jump: jump))
    }
}

/// A message to scroll the thread to, each ask its own even for the same message.
struct MessageJump: Equatable {
    let id: String
    private let ask = UUID()

    init(id: String) { self.id = id }
}

/// A thread stays at its end while it settles after opening, a new message or
/// an answer ending (the lazy list only guessed the heights of rows it hadn't
/// drawn, the composer takes its room a pass later, and a finished turn folds
/// its trace), while an answer streams and when the keyboard or the composer
/// takes room, as long as you're at the end. Scrolling up stops that, coming
/// back down or sending starts it again, and what you unfold yourself grows
/// downward. Content shrinking under you never leaves you past its end.
private struct FollowEnd: ViewModifier {
    let live: Bool
    /// The newest message's id.
    let last: String?
    /// The newest message is one sent from this phone.
    let mine: Bool
    let jump: MessageJump?
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var following = true
    @State private var settling = true
    @State private var touching = false

    func body(content: Content) -> some View {
        content
            .scrollPosition($position)
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .onScrollPhaseChange { _, phase, context in
                touching = phase == .tracking || phase == .interacting || phase == .decelerating
                if touching { settling = false }
                if phase == .idle { following = atEnd(context.geometry) }
            }
            .onScrollGeometryChange(for: Extent.self, of: Extent.init) { old, new in
                guard !touching else { return }
                if new.beyond || following && (settling || live || new.room != old.room) {
                    position.scrollTo(edge: .bottom)
                }
            }
            .onChange(of: last) {
                if mine { following = true }
                // Not mid-flick: where the flick stops decides whether it follows.
                if following && (mine || !touching) { position.scrollTo(edge: .bottom) }
            }
            .task(id: jump) {
                guard let jump else { return }
                following = false
                settling = false
                // The lazy stack only guessed the heights of rows it hadn't drawn: aimed again
                // once the ones passed on the way are measured, it lands on the message.
                withAnimation { position.scrollTo(id: jump.id, anchor: .top) }
                for _ in 0..<3 {
                    try? await Task.sleep(for: .milliseconds(350))
                    if Task.isCancelled || touching { return }
                    withAnimation(.snappy) { position.scrollTo(id: jump.id, anchor: .top) }
                }
            }
            .task(id: Settle(last: last, live: live)) {
                settling = true
                try? await Task.sleep(for: .seconds(1.5))
                if !Task.isCancelled { settling = false }
            }
    }
}

private struct Settle: Equatable {
    let last: String?
    let live: Bool
}

/// What moves the end: the content, the room for it, and whether the view
/// was left past it.
private struct Extent: Equatable {
    var content: CGFloat
    /// The height and insets the keyboard and the composer change.
    var room: [CGFloat]
    var beyond: Bool

    init(_ g: ScrollGeometry) {
        content = g.contentSize.height
        room = [g.containerSize.height, g.contentInsets.top, g.contentInsets.bottom]
        beyond = g.contentOffset.y > furthest(g) + 1
    }
}

/// The container leaves out the insets, so the end's offset is the content
/// less the container and the top inset.
private func end(_ g: ScrollGeometry) -> CGFloat {
    g.contentSize.height - g.containerSize.height - g.contentInsets.top
}

/// Further than a short thread's rest at the top or a long one's end.
private func furthest(_ g: ScrollGeometry) -> CGFloat { max(end(g), -g.contentInsets.top) }

/// Within a few points of the end.
private func atEnd(_ g: ScrollGeometry) -> Bool { g.contentOffset.y >= end(g) - 24 }
