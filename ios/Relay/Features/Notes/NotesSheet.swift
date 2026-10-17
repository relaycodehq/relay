import RelayRemote
import SwiftUI

// The desktop's NotesChip on a phone (Android's NotesSheet.kt): the notes the thread keeps,
// opened from its menu. Lists tick off; tapping a note or an item quotes it
// into the composer. Keeping, pinning and reordering stay on the computer.

/// How many notes the thread keeps, and whether their sheet is up: the thread menu lists them
/// rather than the bar, which had no room for a fourth mark.
struct ThreadNotesEntry: Equatable {
    var count = 0
    var open = false
}

extension View {
    /// Follows the thread's notes and shows their sheet; `entry.count` stays 0 while it keeps
    /// none or its computer can't share them. `quote` puts markdown in the composer; `show`
    /// scrolls the thread to a message a note was kept from, one of those `present` in it.
    func threadNotes(
        chatId: String, shown: Bool, entry: Binding<ThreadNotesEntry>, present: Set<String>,
        quote: @escaping (String) -> Void, show: @escaping (String) -> Void
    ) -> some View {
        modifier(ThreadNotesSheet(chatId: chatId, shown: shown, entry: entry, present: present, quote: quote, show: show))
    }
}

private struct ThreadNotesSheet: ViewModifier {
    let chatId: String
    let shown: Bool
    @Binding var entry: ThreadNotesEntry
    let present: Set<String>
    let quote: (String) -> Void
    let show: (String) -> Void
    @Environment(Connection.self) private var connection
    @State private var model: ThreadNotesModel?

    private var shared: Bool { (connection.overview?.bridge ?? 1) >= Bridge.notes }
    private var mark: String? { connection.chats.first { $0.id == chatId }?.notesMark }

    func body(content: Content) -> some View {
        let count = shown && shared ? model?.notes.count ?? 0 : 0
        content
            .onChange(of: count, initial: true) { entry.count = $1 }
            .sheet(isPresented: $entry.open) {
                if let model {
                    NotesSheet(model: model, present: present) { text in
                        entry.open = false
                        quote(text)
                    } jump: { id in
                        entry.open = false
                        show(id)
                    }
                    .presentationDetents([.medium, .large])
                }
            }
            .task(id: Follow(mark: mark, online: connection.status.state == .online, shared: shared, computer: connection.active)) {
                guard shown, shared else { return }
                if model == nil || model?.key != "\(connection.active ?? "")|\(chatId)" {
                    model = ThreadNotesModel(chatId: chatId, computer: connection.active)
                }
                await model?.follow(mark: mark, online: connection.status.state == .online, connection)
            }
    }
}

private struct Follow: Equatable {
    let mark: String?
    let online: Bool
    let shared: Bool
    let computer: String?
}

private struct NotesSheet: View {
    let model: ThreadNotesModel
    let present: Set<String>
    let quote: (String) -> Void
    let jump: (String) -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.notes) { note in
                        NoteCard(
                            note: note, model: model, quote: quote,
                            jump: note.from.flatMap { from in present.contains(from) ? { jump(from) } : nil })
                    }
                } footer: {
                    if let failure = model.failure {
                        Text(failure).foregroundStyle(colors.destructive)
                    }
                }
            }
            .listStyle(.plain)
            .relayBackground()
            .navigationTitle("Notes")
            .navigationSubtitle("Tap one to quote it in your message.")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct NoteCard: View {
    let note: ThreadNote
    let model: ThreadNotesModel
    let quote: (String) -> Void
    /// Scrolls the thread to the message it was kept from, while that's in it.
    let jump: (() -> Void)?
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors

    var body: some View {
        let list = note.ref == true ? nil : noteList(note.text)
        let whole = noteQuote(note)
        VStack(alignment: .leading, spacing: 6) {
            if note.ref == true {
                Button { jump?() } label: {
                    Label { Text(note.text) } icon: { Image(systemName: "text.bubble") }
                        .foregroundStyle(jump != nil ? colors.foreground : colors.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(jump == nil)
            } else if let list {
                if !list.lead.isEmpty { inline(list.lead) }
                let done = Set(note.done ?? [])
                ForEach(Array(list.items.enumerated()), id: \.offset) { index, item in
                    ItemRow(item: item, done: done.contains(index)) {
                        model.tick(note, index: index, done: !done.contains(index), connection)
                    } quote: {
                        let text = noteQuote(note, index: index)
                        if !text.isEmpty { quote(text) }
                    }
                }
            } else {
                Button { quote(note.text) } label: { inline(note.text) }.buttonStyle(.plain)
            }
            HStack(spacing: 14) {
                Text(note.by.map { "Kept by \(agentName($0))" } ?? "")
                    .font(.caption)
                    .foregroundStyle(colors.faint)
                    .lineLimit(1)
                Spacer()
                if let jump, note.ref != true {
                    Button(action: jump) { Image(systemName: "arrow.up.to.line") }
                        .accessibilityLabel("Show where it was kept")
                }
                Button {
                    quote(whole)
                } label: {
                    Image(systemName: "text.quote")
                }
                .disabled(whole.isEmpty)
                .accessibilityLabel(
                    note.ref == true
                        ? "Point your message at it"
                        : whole.isEmpty
                            ? "All done; untick an item to quote it"
                            : list != nil && whole != note.text ? "Quote what's left in your message" : "Quote it in your message")
                Button { model.remove(note, connection) } label: { Image(systemName: "xmark") }
                    .accessibilityLabel(note.ref == true ? "Unpin" : "Remove note")
            }
            .buttonStyle(.borderless)
            .foregroundStyle(colors.muted)
            .font(.subheadline)
        }
        .padding(12)
        .background(colors.card, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(colors.border, lineWidth: 0.5))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
    }

    private func inline(_ markdown: String) -> some View {
        Text(noteMarkdown(markdown))
            .font(.subheadline)
            .foregroundStyle(colors.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
    }
}

/// A list item: its box ticks it, its text quotes it while it's still to do.
private struct ItemRow: View {
    let item: NoteItem
    let done: Bool
    let tick: () -> Void
    let quote: () -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button(action: tick) {
                Image(systemName: done ? "checkmark.square.fill" : "square")
                    .foregroundStyle(done ? colors.foreground : colors.muted)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(done ? "Mark not done" : "Mark done")
            Button(action: quote) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if !item.number.isEmpty { Text(item.number).foregroundStyle(colors.muted) }
                    Text(noteMarkdown(item.text)).foregroundStyle(colors.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(.subheadline)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(done)
            .opacity(done ? 0.5 : 1)
        }
    }
}

/// A note's markdown as one run of text: its emphasis, code and links, its lines kept.
private func noteMarkdown(_ text: String) -> AttributedString {
    (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
        ?? AttributedString(text)
}
