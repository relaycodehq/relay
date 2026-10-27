import RelayRemote
import SwiftUI

/// A run the agent has moved on from, once commentary or the end of the turn closed it, grouped by
/// what its calls did (shared/trace-tree): one line when its tree is long, opening to that tree. The
/// turn's only run shows its tree as it is, since the turn's heading already says what it did.
struct ClosedRun: View {
    let calls: [AgentActivity]
    let only: Bool
    let context: CallContext

    var body: some View {
        let run = traceRun(calls)
        if let summary = run.summary, !only {
            TreeFold(
                symbol: branchSymbol(firstKind(run.pieces[0])), heading: summary,
                failed: allFailed(run.pieces.flatMap(\.rows)), items: run.pieces
            ) { PieceView(piece: $0, context: context) }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(run.pieces) { PieceView(piece: $0, context: context) }
            }
        }
    }

    /// What kind the run started with, for its folded line's icon.
    private func firstKind(_ piece: TracePiece) -> BranchKind {
        if case .branch(let kind, _, _) = piece { return kind }
        return branchOf(piece.rows[0].action)
    }
}

/// One or two rows of a kind stay rows; three and up fold into a branch.
private struct PieceView: View {
    let piece: TracePiece
    let context: CallContext

    var body: some View {
        switch piece {
        case .row(let row): ActionRow(rows: [row], context: context)
        case .pair(let a, let b): ActionRow(rows: [a, b], context: context)
        case .branch(let kind, let heading, let rows):
            TreeFold(symbol: branchSymbol(kind), heading: heading, failed: allFailed(rows), items: rows) {
                ActionRow(rows: [$0], context: context)
            }
        }
    }
}

/// "Read 4 files", folded; open, what's under it hangs off a line from its icon. Red when anything
/// under it failed.
private struct TreeFold<Item: Identifiable, Content: View>: View {
    let symbol: String
    let heading: String
    let failed: Bool
    let items: [Item]
    @ViewBuilder let content: (Item) -> Content
    @Environment(\.colors) private var colors
    @State private var open = false
    /// Where a row's first line sits, for the elbow to meet it.
    @ScaledMetric(relativeTo: .footnote) private var firstLine: CGFloat = 11

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: symbol).foregroundStyle(colors.muted).frame(width: 16)
                    Text(heading).foregroundStyle(failed ? colors.destructive : colors.muted)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .foregroundStyle(colors.faint)
                }
                .font(.footnote)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        HStack(alignment: .top, spacing: 0) {
                            Elbow(last: index == items.count - 1, at: firstLine)
                                .stroke(colors.border, lineWidth: 1)
                                .frame(width: 20)
                            content(item).padding(.vertical, 3)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
    }
}

/// The tree line beside a row: down from the fold's icon, hooked into the row with a small
/// rounded └, and on past it unless the row is the last.
nonisolated private struct Elbow: Shape {
    let last: Bool
    /// How far down the row its first line's middle is.
    let at: CGFloat

    func path(in rect: CGRect) -> Path {
        let x = 7.5
        let radius = 5.0
        let end = 16.0
        var path = Path()
        path.move(to: CGPoint(x: x, y: 0))
        path.addLine(to: CGPoint(x: x, y: at - radius))
        path.addQuadCurve(to: CGPoint(x: x + radius, y: at), control: CGPoint(x: x, y: at))
        path.addLine(to: CGPoint(x: end, y: at))
        if !last {
            path.move(to: CGPoint(x: x, y: at - radius))
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
        }
        return path
    }
}
