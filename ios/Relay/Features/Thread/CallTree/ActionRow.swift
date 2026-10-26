import RelayRemote
import SwiftUI

/// One row of a run told by what its calls did, or two that one verb carries; a tap opens what
/// they wrote or ran. Tools, agents and questions keep the rows they had.
struct ActionRow: View {
    let rows: [TraceRow]
    let context: CallContext
    @Environment(\.colors) private var colors
    @State private var open = false

    private var calls: [AgentActivity] {
        var seen = Set<String>()
        return rows.flatMap(\.calls).filter { seen.insert($0.id).inserted }
    }

    var body: some View {
        if rows[0].action == .tool {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(calls) { call in
                    ToolRow(
                        chatId: context.chatId, messageId: context.messageId, activity: call,
                        calls: context.subagentCalls[call.id] ?? [], root: context.root, looked: context.looked)
                }
            }
        } else {
            told
        }
    }

    private var told: some View {
        let opens = opensToSomething(calls)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                icon.frame(width: 16)
                words.textRenderer(ChipBoxes(fill: colors.foreground.opacity(0.07)))
                Spacer(minLength: 0)
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .contentShape(.rect)
            .onTapGesture {
                guard opens else { return }
                withAnimation(.snappy(duration: 0.2)) { open.toggle() }
            }
            .accessibilityAddTraits(opens ? .isButton : [])
            .selectsOnHold(calls.map(\.label).joined(separator: "\n"), mono: calls[0].kind == "command")
            ForEach(calls.filter(showsPicture)) { call in
                if let path = imagePath(call) {
                    ReadPreview(
                        source: .read(chatId: context.chatId, messageId: context.messageId, path: path),
                        name: fileName(path), done: call.status == "complete", among: context.looked
                    )
                    .padding(.leading, 24)
                    .id(path)
                }
            }
            if open {
                RowOpened(rows: rows, calls: calls, context: context).padding(.leading, 24)
            }
        }
    }

    private var words: Text {
        var words = RowWords(colors: colors)
        if rows.count == 2 { words.tell(rows[0], and: rows[1]) } else { words.tell(rows[0]) }
        return words.text
    }

    @ViewBuilder private var icon: some View {
        if rows.contains(where: rowRunning) {
            Spinner(size: 13)
        } else {
            Image(systemName: actionSymbol(rows[0].action))
                .foregroundStyle(rows.contains(where: rowFailed) ? colors.destructive : colors.muted)
        }
    }

    private func showsPicture(_ call: AgentActivity) -> Bool {
        context.canFetch && looksAtImage(call)
    }
}
