import SwiftUI

extension View {
    /// Keeps a thread's scroll view at its end while it should be there; `jump` scrolls to a message.
    /// The thread's lazy stack needs `.scrollTargetLayout()` and a `ThreadEnd()` as its last row.
    func followingEnd(live: Bool, last: String?, mine: Bool, jump: MessageJump? = nil) -> some View {
        modifier(FollowEnd(live: live, last: last, mine: mine, jump: jump))
    }
}

/// Opens or closes something the reader tapped in a thread. The thread doesn't
/// follow its end while that grows or shrinks, so the row stays under the finger;
/// once it has, the thread follows on only if its end is still on screen.
struct ReaderUnfold {
    fileprivate var hold: (Bool) -> Void = { _ in }

    func callAsFunction(_ animation: Animation = .snappy(duration: 0.2), _ change: () -> Void) {
        hold(true)
        withAnimation(animation, change) { hold(false) }
    }
}

extension EnvironmentValues {
    @Entry var unfold = ReaderUnfold()
}

/// A message to scroll the thread to, each ask its own even for the same message.
struct MessageJump: Equatable {
    let id: String
    private let ask = UUID()

    init(id: String) { self.id = id }
}

/// The thread's last row, the room under its last line. Never zero high: a row with
/// no height is never on screen, so the thread couldn't tell it's at its end.
struct ThreadEnd: View {
    static let id = "thread-end"

    var body: some View {
        // With the stack's spacing above it, 60pt under the last line, as on the desktop.
        Color.clear.frame(height: 42).id(Self.id)
    }
}

/// A thread stays at its end while it settles after opening, a new message or
/// an answer ending (the composer takes its room a pass later, and a finished
/// turn folds its trace), while an answer streams and when the keyboard or the
/// composer takes room, as long as you're at the end. Scrolling up stops that,
/// coming back down or sending starts it again, and what you unfold yourself
/// grows downward.
///
/// As Android's ThreadScroll does, the end is a row to scroll to and to see on
/// screen, never an offset: the lazy stack only guesses the heights of rows it
/// hasn't drawn (one tall answer had it guess a 27,000pt thread at 64,000), so
/// the content size and every offset worked out from it can point far past the
/// last row, and the thread showed nothing until you scrolled.
private struct FollowEnd: ViewModifier {
    let live: Bool
    /// The newest message's id.
    let last: String?
    /// The newest message is one sent from this phone.
    let mine: Bool
    let jump: MessageJump?
    @State private var position = ScrollPosition(id: ThreadEnd.id, anchor: .bottom)
    @State private var following = true
    @State private var settling = true
    @State private var touching = false
    /// The end row is on screen.
    @State private var atEnd = true
    /// What the reader is unfolding, each until it has laid out; see `ReaderUnfold`.
    @State private var unfolding = 0

    func body(content: Content) -> some View {
        content
            .environment(\.unfold, ReaderUnfold(hold: hold))
            .scrollPosition($position)
            .onScrollTargetVisibilityChange(idType: String.self, threshold: 0.5) { shown in
                atEnd = shown.contains(ThreadEnd.id)
                // Only your own scrolling decides; the thread following or growing doesn't.
                if touching { following = atEnd }
            }
            .onScrollPhaseChange { _, phase in
                touching = phase == .tracking || phase == .interacting || phase == .decelerating
                if touching { settling = false }
                if phase == .idle { following = atEnd }
            }
            .onScrollGeometryChange(for: Extent.self, of: Extent.init) { old, new in
                guard !touching, unfolding == 0, following,
                    settling || live || new.room != old.room || new.content < old.content
                else { return }
                follow()
            }
            .onChange(of: last) {
                if mine { following = true }
                // Not mid-flick: where the flick stops decides whether it follows.
                if following && (mine || !touching) { follow() }
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

    private func hold(_ held: Bool) {
        // A fold's steps arriving overlap the tap that opened it; the last to lay out decides.
        unfolding += held ? 1 : -1
        // A position on the end row keeps that row at the bottom while what's above it grows;
        // an empty one leaves the thread where it is.
        if held {
            position = ScrollPosition(idType: String.self)
        } else if unfolding == 0 {
            following = following && atEnd
        }
    }

    private func follow() {
        position.scrollTo(id: ThreadEnd.id, anchor: .bottom)
    }
}

private struct Settle: Equatable {
    let last: String?
    let live: Bool
}

/// What moves the end: the content and the room for it.
private struct Extent: Equatable {
    var content: CGFloat
    /// The height and insets the keyboard and the composer change.
    var room: [CGFloat]

    init(_ g: ScrollGeometry) {
        content = g.contentSize.height
        room = [g.containerSize.height, g.contentInsets.top, g.contentInsets.bottom]
    }
}
