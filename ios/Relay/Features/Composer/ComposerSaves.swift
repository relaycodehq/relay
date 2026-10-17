import CryptoKit
import Foundation
import RelayRemote

/// What a new thread starts on, so its composer is there before the computer answers.
nonisolated struct SavedNewThread: Codable {
    var settings: ResumeSettings
    var models: NewThreadModels
}

/// Android's ComposerSaves: the agents' model lists and a new thread's start as each computer
/// last said them, so a composer names its model and a new thread opens on its agent before
/// the computer answers, or while it can't. Kept in Caches: the system may clear them, and
/// the next answer brings them back.
nonisolated struct ComposerSaves {
    private let root = URL.cachesDirectory.appending(path: "relay-offline", directoryHint: .isDirectory)

    /// A computer's own folder, named by a hash of its key.
    private func file(_ computer: String, _ name: String) -> URL {
        let digest = SHA256.hash(data: Data(computer.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
        return root.appending(path: digest, directoryHint: .isDirectory).appending(path: name)
    }

    private func read<T: Decodable>(_ url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    /// A full disk costs the saved copy, nothing else.
    private func write(_ value: some Encodable, _ url: URL) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    func models(_ computer: String) -> ModelCatalogs { read(file(computer, "models.json")) ?? [:] }
    func saveModels(_ computer: String, _ lists: ModelCatalogs) { write(lists, file(computer, "models.json")) }

    func newThread(_ computer: String) -> SavedNewThread? { read(file(computer, "new-thread.json")) }
    func saveNewThread(_ computer: String, _ start: SavedNewThread) { write(start, file(computer, "new-thread.json")) }

    /// A computer forgotten takes its copies with it.
    func forget(_ computer: String) {
        try? FileManager.default.removeItem(at: file(computer, "models.json").deletingLastPathComponent())
    }
}
