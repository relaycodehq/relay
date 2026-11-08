import CryptoKit
import Foundation

/// A piece of an answer's video as `projectChatVideoPart` returns it (shared/answer-images VideoPart).
public struct VideoPart: Sendable {
    public var size: Int64
    /// Base64.
    public var data: String

    public init(size: Int64, data: String) {
        self.size = size
        self.data = data
    }
}

/// Bigger than this, a video isn't worth pulling to the phone.
public let maxVideoBytes: Int64 = 500 * 1024 * 1024

public struct VideoTooBig: Error {
    public let size: Int64
}

/// Answer videos downloaded from the computer, since the phone can't stream them from
/// there: one file per computer, answer and path, in `dir`, the least recently played
/// going first once they take more than `keepBytes`.
public actor VideoFiles {
    private let dir: URL
    private let keepBytes: Int64
    private var downloads: [String: Task<URL, Error>] = [:]

    public init(dir: URL, keepBytes: Int64 = 1024 * 1024 * 1024) {
        self.dir = dir
        self.keepBytes = keepBytes
    }

    public nonisolated func file(for key: String, path: String) -> URL {
        let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined().prefix(32)
        let ext = path.split(separator: ".").last.map { $0.lowercased() } ?? "mp4"
        return dir.appendingPathComponent("\(name).\(ext)")
    }

    /// The video's file here, downloading it first if it isn't yet; `progress` hears bytes
    /// so far of all. The same video asked for twice downloads once.
    public func download(
        key: String,
        path: String,
        fetch: @escaping @Sendable (_ offset: Int64) async throws -> VideoPart,
        progress: @escaping @Sendable (_ done: Int64, _ size: Int64) -> Void = { _, _ in }
    ) async throws -> URL {
        let target = file(for: key, path: path)
        if FileManager.default.fileExists(atPath: target.path) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: target.path)
            return target
        }
        if let running = downloads[key] { return try await running.value }
        let dir = dir, keep = keepBytes
        let task = Task {
            try await Self.fetchAll(into: target, dir: dir, fetch: fetch, progress: progress)
            Self.trim(dir, keepBytes: keep, except: target)
            return target
        }
        downloads[key] = task
        defer { downloads[key] = nil }
        return try await task.value
    }

    private static func fetchAll(
        into target: URL,
        dir: URL,
        fetch: @Sendable (Int64) async throws -> VideoPart,
        progress: @Sendable (Int64, Int64) -> Void
    ) async throws {
        let files = FileManager.default
        try files.createDirectory(at: dir, withIntermediateDirectories: true)
        // A part left by a download that was cut off may be of an older file; start over.
        let part = target.appendingPathExtension("part")
        try? files.removeItem(at: part)
        files.createFile(atPath: part.path, contents: nil)
        let handle = try FileHandle(forWritingTo: part)
        defer { try? handle.close() }
        var done: Int64 = 0
        while true {
            try Task.checkCancellation()
            let piece = try await fetch(done)
            if piece.size > maxVideoBytes { throw VideoTooBig(size: piece.size) }
            guard let bytes = Data(base64Encoded: piece.data) else { throw RemoteCallError.rejected("Not a video.") }
            try handle.write(contentsOf: bytes)
            done += Int64(bytes.count)
            progress(done, piece.size)
            if done >= piece.size { break }
            if bytes.isEmpty { throw RemoteCallError.rejected("The video ended before its size.") }
        }
        try handle.close()
        try files.moveItem(at: part, to: target)
    }

    private static func trim(_ dir: URL, keepBytes: Int64, except: URL) {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        let kept = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? []
        let played = kept.filter { $0.pathExtension != "part" }.map { url in
            let values = try? url.resourceValues(forKeys: Set(keys))
            return (url, values?.contentModificationDate ?? .distantPast, Int64(values?.fileSize ?? 0))
        }.sorted { $0.1 > $1.1 }
        var total: Int64 = 0
        for (url, _, size) in played {
            total += size
            if total > keepBytes, url.standardizedFileURL != except.standardizedFileURL {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }
}

public extension RemoteClient {
    /// `videoPartBytes` of an answer's video from `offset`; from `Bridge.video`.
    func videoPart(chatId: String, messageId: String, path: String, offset: Int64) async throws -> VideoPart {
        let part = try await desktop(
            "projectChatVideoPart", [.string(chatId), .string(messageId), .string(path), .number(Double(offset))])
        guard let size = part["size"]?.int, let data = part["data"]?.string else { throw RemoteCallError.rejected("Not a video.") }
        return VideoPart(size: Int64(size), data: data)
    }
}
