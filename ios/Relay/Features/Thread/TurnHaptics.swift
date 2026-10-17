import RelayRemote
import SwiftUI

extension View {
    /// The thread on screen buzzes as its turn ends or it starts asking; the
    /// needs-you alerts cover every other thread.
    func turnHaptics(_ summary: RemoteChatSummary?, answer: ChatMessage?) -> some View {
        modifier(TurnHaptics(summary: summary, answer: answer))
    }
}

private struct TurnHaptics: ViewModifier {
    let summary: RemoteChatSummary?
    let answer: ChatMessage?
    @Environment(Connection.self) private var connection
    @Environment(\.scenePhase) private var phase
    @State private var watch: TurnWatch?
    @State private var buzz: (feedback: TurnFeedback, count: Int)?

    private var sight: TurnSight? {
        summary.map {
            TurnSight(
                running: $0.running == true, since: $0.runningSince, waiting: $0.waiting == true,
                answer: answer.map { TurnAnswer(created: $0.created, status: $0.status) })
        }
    }

    /// Seen in front and online; a change of either takes a fresh look, so catching up never counts.
    private var watching: Bool { phase == .active && connection.status.state == .online }

    func body(content: Content) -> some View {
        content
            .onChange(of: watching, initial: true) { watch = nil }
            .onChange(of: sight, initial: true) { _, sight in
                guard watching, let sight else { return }
                let (next, feedback) = watchTurn(watch, sight)
                watch = next
                if let feedback { buzz = (feedback, (buzz?.count ?? 0) + 1) }
            }
            .sensoryFeedback(trigger: buzz?.count) {
                switch buzz?.feedback {
                case .success?: .success
                case .error?: .error
                case .warning?: .warning
                case nil: nil
                }
            }
    }
}
