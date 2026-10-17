import SwiftUI

/// Held longer than this, the mic is push-to-talk and letting go finishes.
private let holdSeconds = 0.35

/// The composer's mic: tap to start, tap again to finish, or hold to talk and let go.
/// While listening it widens into the live level with a small square that says tapping finishes.
struct DictationButton: View {
    let session: DictationSession
    let start: () -> Void
    /// When the press began, and whether it started the listening.
    @State private var pressed: (at: Date, started: Bool)?

    var body: some View {
        label
            .foregroundStyle(session.phase == .idle ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
            // Starts on the press, not the release, so holding is talking.
            .onLongPressGesture(minimumDuration: .infinity) {} onPressingChanged: { down in
                if down {
                    guard session.phase != .finishing else { return }
                    let idle = session.phase == .idle
                    pressed = (Date(), idle)
                    if idle { start() }
                } else if let press = pressed {
                    pressed = nil
                    // A tap on the live capsule finishes; so does letting go after holding.
                    if !press.started || Date().timeIntervalSince(press.at) >= holdSeconds { session.stop() }
                }
            }
            .animation(.spring(duration: 0.25), value: session.phase)
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(session.phase == .idle ? "Dictate" : "Finish dictation")
            .accessibilityAction {
                if session.phase == .idle { start() } else { session.stop() }
            }
            .sensoryFeedback(.impact(weight: .light), trigger: session.phase == .idle)
    }

    private var label: some View {
        Group {
            if session.phase == .idle {
                Image(systemName: "mic")
                    .font(.system(size: 19))
                    .frame(width: 36, height: 36)
            } else {
                HStack(spacing: 10) {
                    if session.phase == .listening && !session.loading {
                        LevelBars(levels: session.levels)
                    } else {
                        ProgressView().controlSize(.small)
                    }
                    RoundedRectangle(cornerRadius: 2.5).frame(width: 10, height: 10)
                }
                .frame(height: 36)
                .padding(.horizontal, 6)
            }
        }
        .contentShape(.rect)
    }
}

private struct LevelBars: View {
    let levels: [Double]

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(levels.indices, id: \.self) { i in
                Capsule()
                    .frame(width: 3, height: 3 + 15 * levels[i])
                    // Older bars fade toward the left.
                    .opacity(0.4 + 0.6 * Double(i) / Double(max(levels.count - 1, 1)))
            }
        }
        .frame(height: 18)
        .animation(.spring(duration: 0.15), value: levels)
    }
}
