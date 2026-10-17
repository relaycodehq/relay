import RelayRemote
import SwiftUI

/// A thread's notes (the desktop's useThreadNotes, Android's ThreadNotes.kt): fetched again
/// whenever its summary's `notesMark` moves, so one an agent keeps shows up without asking.
/// Ticks and removals show at once and settle on what the computer answers.
@Observable
final class ThreadNotesModel {
    let chatId: String
    /// Computer and thread.
    let key: String
    private(set) var notes: [ThreadNote]
    var failure: String?

    init(chatId: String, computer: String?) {
        self.chatId = chatId
        key = "\(computer ?? "")|\(chatId)"
        notes = NotesKept.notes(key) ?? []
    }

    private func settle(_ next: [ThreadNote]) {
        notes = next
        NotesKept.keep(key, mark: notesMark(next), next)
    }

    /// The computer's copy; nil when it can't be asked, and the next move of the mark asks again.
    private func fetch(_ connection: Connection) async -> [ThreadNote]? {
        try? await connection.liveClient().threadNotes(chatId: chatId)
    }

    func follow(mark: String?, online: Bool, _ connection: Connection) async {
        guard let mark else { return settle([]) }
        if NotesKept.mark(key) == mark || !online { return }
        if let fresh = await fetch(connection) { settle(fresh) }
    }

    /// Ticks item `index` (from 0) of a list note, or unticks it.
    func tick(_ note: ThreadNote, index: Int, done: Bool, _ connection: Connection) {
        change({ ticked($0, id: note.id, index: index, done: done) }, failed: "Couldn't tick it", connection) {
            try await connection.liveClient().tickThreadNote(chatId: self.chatId, noteId: note.id, index: index, done: done)
        }
    }

    func remove(_ note: ThreadNote, _ connection: Connection) {
        change({ $0.filter { $0.id != note.id } }, failed: "Couldn't remove it", connection) {
            try await connection.liveClient().removeThreadNote(chatId: self.chatId, noteId: note.id)
        }
    }

    private func change(
        _ here: ([ThreadNote]) -> [ThreadNote], failed: String, _ connection: Connection,
        save: @escaping () async throws -> [ThreadNote]
    ) {
        let before = notes
        notes = here(before)
        Task {
            do {
                settle(try await save())
            } catch {
                failure = "\(failed): \(error.localizedDescription)"
                if let fresh = await fetch(connection) { settle(fresh) } else { notes = before }
            }
        }
    }
}

/// The notes each thread showed last, with the mark they were fetched at, so a thread opened
/// again shows its pin at once.
@MainActor
private enum NotesKept {
    private static var kept: [String: (mark: String?, notes: [ThreadNote])] = [:]
    private static var order: [String] = []

    static func notes(_ key: String) -> [ThreadNote]? { kept[key]?.notes }
    static func mark(_ key: String) -> String?? { kept[key].map(\.mark) }

    static func keep(_ key: String, mark: String?, _ notes: [ThreadNote]) {
        if kept[key] == nil { order.append(key) }
        kept[key] = (mark, notes)
        if order.count > 32 { kept[order.removeFirst()] = nil }
    }
}
