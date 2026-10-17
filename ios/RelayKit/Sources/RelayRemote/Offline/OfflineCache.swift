import Foundation

/// Each computer's last overview, shown while it connects or can't. One JSON file per computer.
public struct OfflineCache: Sendable {
    let dir: URL

    public init(dir: URL) { self.dir = dir }

    private func file(_ computer: String) -> URL { dir.appending(path: "\(safeName(computer)).json") }

    public func load(_ computer: String) -> RemoteOverview? {
        guard let data = try? Data(contentsOf: file(computer)) else { return nil }
        return try? JSONDecoder().decode(RemoteOverview.self, from: data)
    }

    public func save(_ computer: String, _ overview: RemoteOverview) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? JSONEncoder().encode(overview).write(to: file(computer), options: .atomic)
    }

    public func forget(_ computer: String) {
        try? FileManager.default.removeItem(at: file(computer))
    }
}

/// When the phone last reached each computer, by key; not secret, so a plain JSON file.
public struct ComputerSeen: Sendable {
    let file: URL

    public init(file: URL) { self.file = file }

    /// The app's own, in Application Support.
    public static let app = ComputerSeen(file: URL.applicationSupportDirectory.appending(path: "computers-seen.json"))

    public func load() -> [String: Int64] {
        guard let data = try? Data(contentsOf: file) else { return [:] }
        return (try? JSONDecoder().decode([String: Int64].self, from: data)) ?? [:]
    }

    public func save(_ seen: [String: Int64]) {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(seen).write(to: file, options: .atomic)
    }
}

/// A computer's key as a file name.
private func safeName(_ id: String) -> String {
    String(id.map { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") ? $0 : "_" })
}
