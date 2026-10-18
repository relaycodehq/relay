import RelayRemote
import SwiftUI

/// The desktop's ChangedFilesCard under an answer: what the turn changed, a
/// file opening its diff, and rolling the turn back or forward.
struct ChangedFiles: View {
    let chatId: String
    let message: ChatMessage
    let files: [TurnFileChange]
    @Environment(\.colors) private var colors
    @State private var rewind = Rewinding()

    var body: some View {
        let reverted = files.filter { $0.revertedBy != nil }.count
        let redo = reverted == files.count
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                NavigationLink(value: Route.git(.turn(chatId: chatId, messageId: message.id))) {
                    Text(files.count == 1 ? "1 file changed" : "\(files.count) files changed")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(colors.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                Counts(add: files.reduce(0) { $0 + $1.additions }, del: files.reduce(0) { $0 + $1.deletions })
                Button {
                    if redo {
                        rewind.run(chatId, message.id, nil, "redo")
                    } else if files.count - reverted > 1 {
                        rewind.ask(chatId, message.id, files: files.count - reverted)
                    } else {
                        rewind.run(chatId, message.id, nil, "revert")
                    }
                } label: {
                    Label(redo ? "Redo" : "Roll back", systemImage: redo ? "arrow.uturn.forward" : "arrow.uturn.backward")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .labelStyle(Tight())
                }
                .disabled(rewind.working)
                .opacity(rewind.working ? 0.5 : 1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            Rectangle().fill(colors.border).frame(height: 1)
            ForEach(files, id: \.path) { f in
                NavigationLink(value: Route.git(.diff(.turn(chatId: chatId, messageId: message.id, path: f.path)))) {
                    FileLine(file: f)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .contentShape(.rect)
                }
            }
        }
        .buttonStyle(.plain)
        .background(colors.card, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(colors.border))
        .rewindPrompts(rewind)
    }
}

/// A changed file: its name, its folder faintly, and what changed in it.
struct FileLine: View {
    let file: TurnFileChange
    var folder = true
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 10) {
            let dir = folderOf(file.path)
            let name = Text(fileName(file.path))
                .foregroundStyle(file.revertedBy == nil ? colors.foreground : colors.muted)
                .strikethrough(file.revertedBy != nil)
            let place = Text(folder && !dir.isEmpty ? "  \(dir)" : "").foregroundStyle(colors.faint)
            Text("\(name)\(place)")
                .font(.mono(.footnote))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            if file.binary == true {
                Text("binary").font(.mono(.caption)).foregroundStyle(colors.muted)
            } else {
                Counts(add: file.additions, del: file.deletions)
            }
        }
    }
}

struct Counts: View {
    let add: Int
    let del: Int
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 8) {
            Text("+\(add)").foregroundStyle(colors.additionText)
            Text("−\(del)").foregroundStyle(colors.deletionText)
        }
        .font(.mono(.caption))
        .fixedSize()
    }
}

private struct Tight: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon
            configuration.title
        }
    }
}

/// A rollback in flight, and what it asks: whether to roll back several
/// files, and whether to overwrite when later edits overlap it.
@Observable
final class Rewinding {
    var working = false
    /// How many files a rollback of all of them would touch, while it asks.
    var confirming: Int?
    var overlap: (mode: String, conflicts: [String], paths: [String]?)?
    var failure: String?
    /// The last call, for "Overwrite anyway" and the confirmation.
    private var last: (chatId: String, messageId: String)?
    private var connection: Connection?

    func bind(_ connection: Connection) { self.connection = connection }

    func run(_ chatId: String, _ messageId: String, _ paths: [String]?, _ mode: String, force: Bool = false) {
        guard let connection else { return }
        last = (chatId, messageId)
        working = true
        Task {
            defer { working = false }
            do {
                let conflicts = try await connection.rewind(
                    chatId, turn: messageId, paths: paths, mode: mode, force: force)
                if !conflicts.isEmpty { overlap = (mode, conflicts, paths) }
            } catch {
                failure = error.localizedDescription
            }
        }
    }

    /// Asks before rolling back several files at once.
    func ask(_ chatId: String, _ messageId: String, files: Int) {
        last = (chatId, messageId)
        confirming = files
    }

    func confirmed() {
        guard let last else { return }
        confirming = nil
        run(last.chatId, last.messageId, nil, "revert")
    }

    func overwrite() {
        guard let last, let o = overlap else { return }
        overlap = nil
        run(last.chatId, last.messageId, o.paths, o.mode, force: true)
    }
}

extension View {
    func rewindPrompts(_ rewind: Rewinding) -> some View { modifier(RewindPrompts(rewind: rewind)) }
}

private struct RewindPrompts: ViewModifier {
    let rewind: Rewinding
    @Environment(Connection.self) private var connection

    func body(content: Content) -> some View {
        content
            .onAppear { rewind.bind(connection) }
            .confirmationDialog(
                "Roll back \(rewind.confirming ?? 0) files?",
                isPresented: Binding(get: { rewind.confirming != nil }, set: { if !$0 { rewind.confirming = nil } }),
                titleVisibility: .visible
            ) {
                Button("Roll back", role: .destructive) { rewind.confirmed() }
            } message: {
                Text("They go back to how they were before this turn. Later edits are kept where they merge.")
            }
            .alert(
                "Nothing was changed",
                isPresented: Binding(get: { rewind.overlap != nil }, set: { if !$0 { rewind.overlap = nil } })
            ) {
                Button("Overwrite anyway", role: .destructive) { rewind.overwrite() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(rewind.overlap.map { rewindConflictText($0.conflicts, mode: $0.mode) } ?? "")
            }
            .alert(
                "Couldn't roll back",
                isPresented: Binding(get: { rewind.failure != nil }, set: { if !$0 { rewind.failure = nil } })
            ) {
            } message: {
                Text(rewind.failure ?? "")
            }
    }
}
