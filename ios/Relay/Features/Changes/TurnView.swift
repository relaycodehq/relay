import RelayRemote
import SwiftUI

/// The desktop's Turn changes pane: what one agent turn changed, by folder,
/// each file opening its diff and rolling back on its own.
struct TurnView: View {
    let chatId: String
    let messageId: String
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var rewind = Rewinding()

    private var turn: ChatMessage? { connection.threads[chatId]?.messages.first { $0.id == messageId } }

    var body: some View {
        let files = turn?.changes ?? []
        let reverted = files.filter { $0.revertedBy != nil }.count
        List {
            HStack {
                Text("\(files.count == 1 ? "1 file" : "\(files.count) files") changed\(reverted > 0 ? " · \(reverted) rolled back" : "")")
                    .foregroundStyle(colors.muted)
                Spacer()
                if !files.isEmpty {
                    let redo = reverted == files.count
                    Button(redo ? "Redo all" : "Roll back all", systemImage: redo ? "arrow.uturn.forward" : "arrow.uturn.backward") {
                        if redo {
                            rewind.run(chatId, messageId, nil, "redo")
                        } else {
                            rewind.ask(chatId, messageId, files: files.count - reverted)
                        }
                    }
                    .buttonStyle(.borderless)
                    .disabled(rewind.working)
                }
            }
            .font(.footnote)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            ForEach(byFolder(files), id: \.folder) { group in
                Section {
                    ForEach(group.files, id: \.path) { f in row(f) }
                } header: {
                    if !group.folder.isEmpty {
                        Text("\(group.folder) · \(group.files.count)")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(colors.muted)
                            .textCase(nil)
                    }
                }
            }
        }
        .listStyle(.plain)
        .relayBackground()
        .overlay {
            if turn == nil { ProgressView() }
        }
        .navigationTitle(turn.map { "\(agentName($0.provider)) · \(Clock().clock($0.ended ?? $0.created))" } ?? "Changes")
        .navigationBarTitleDisplayMode(.inline)
        .rewindPrompts(rewind)
        .task { if turn == nil { await connection.load(chatId) } }
    }

    private func row(_ f: TurnFileChange) -> some View {
        HStack(spacing: 4) {
            NavigationLink(value: Route.diff(chatId: chatId, messageId: messageId, path: f.path)) {
                FileLine(file: f, folder: false)
            }
            let gone = f.revertedBy != nil
            Button(gone ? "Redo \(f.path)" : "Roll back \(f.path)", systemImage: gone ? "arrow.uturn.forward" : "arrow.uturn.backward") {
                rewind.run(chatId, messageId, [f.path], gone ? "redo" : "revert")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .foregroundStyle(colors.muted)
            .frame(width: 40, height: 36)
            .disabled(rewind.working)
        }
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(colors.border)
    }
}
