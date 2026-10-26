import RelayRemote
import SwiftUI

/// A run of tool calls between two lines of commentary. While the agent works on it, each call is a
/// row of its own in the order it came; once commentary or the end of the turn closes it, the rows
/// give way to the run's grouped form.
struct CallRun: View {
    let calls: [AgentActivity]
    /// The agent is still on it: its rows show one by one, ungrouped.
    let live: Bool
    /// The turn's only run, which its heading already sums up.
    let only: Bool
    let context: CallContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if live {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(rowsOf(calls)) { ActionRow(rows: [$0], context: context) }
                }
                .transition(.opacity)
            } else {
                ClosedRun(calls: calls, only: only, context: context)
                    .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: live)
    }
}
