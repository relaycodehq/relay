import SwiftUI

/// The composer's mic: tap to start, tap again to finish. While listening it
/// widens into the live level with a small square that says tapping finishes.
struct DictationButton: View {
    let session: DictationSession
    let start: () -> Void

    var body: some View {
        Button {
            if session.phase == .idle { start() } else { session.stop() }
        } label: {
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
        .buttonStyle(.plain)
        .foregroundStyle(session.phase == .idle ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
        .disabled(session.phase == .finishing)
        .animation(.spring(duration: 0.25), value: session.phase)
        .accessibilityLabel(session.phase == .idle ? "Dictate" : "Finish dictation")
        .sensoryFeedback(.impact(weight: .light), trigger: session.phase == .idle)
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
