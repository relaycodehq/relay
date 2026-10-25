import RelayRemote
import SwiftUI

/// A run of calls between two lines of commentary, grouped by what they did (shared/trace-tree):
/// one or two of a kind stay rows, three and up fold into a branch.
struct CallPieces: View {
    let calls: [AgentActivity]
    let context: CallContext

    var body: some View {
        ForEach(traceTree(calls)) { piece in
            switch piece {
            case .row(let row): ActionRow(rows: [row], context: context)
            case .pair(let a, let b): ActionRow(rows: [a, b], context: context)
            case .branch(let kind, let heading, let rows): Branch(kind: kind, heading: heading, rows: rows, context: context)
            }
        }
    }
}

/// "Read 4 files", folded; open, its rows hang off a line from its icon.
private struct Branch: View {
    let kind: BranchKind
    let heading: String
    let rows: [TraceRow]
    let context: CallContext
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
                    icon.frame(width: 16)
                    Text(heading).foregroundStyle(checkFailed ? colors.destructive : colors.muted)
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
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        HStack(alignment: .top, spacing: 0) {
                            Elbow(last: index == rows.count - 1, at: firstLine)
                                .stroke(colors.border, lineWidth: 1)
                                .frame(width: 20)
                            ActionRow(rows: [row], context: context)
                                .padding(.vertical, 3)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    @ViewBuilder private var icon: some View {
        if rows.contains(where: rowRunning) {
            Spinner(size: 13)
        } else {
            Image(systemName: branchSymbol(kind)).foregroundStyle(colors.muted)
        }
    }

    private var checkFailed: Bool {
        kind == .check && rows.contains(where: rowFailed)
    }
}

/// The tree line beside a row: down from the branch's icon, hooked into the row with a small
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
