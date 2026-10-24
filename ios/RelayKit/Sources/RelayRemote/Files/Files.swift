import Foundation

// Files a message takes along (shared/remote.ts `uploadFile`, Android's Files.kt): the phone keeps a
// copy, sends it to the computer in chunks, and the message names where the computer put it.

public enum Files {
    /// `fileUploadChunk`: what one `uploadFile` call carries, before base64.
    public static let chunk = 1024 * 1024
    /// `maxUploadBytes`.
    public static let maxBytes: Int64 = 200 * 1024 * 1024
    /// After a failed upload, it's tried again this many times, this long apart; then the send waits for Try again.
    public static let retryDelays: [Duration] = [.seconds(2), .seconds(8), .seconds(30)]

    public static let tooLarge = "That file is too large. Files can be up to 200 MB."
    public static let needsUpdate = "Update Relay on your computer to attach files."
    public static let couldntUpload = "Couldn't upload"
    public static let compressing = "Compressing…"

    public static func uploading(_ percent: Int) -> String { "Uploading \(percent)%" }
}

/// A file going with a message: the phone's copy, and how much of it a computer has.
public struct FileAttachment: Codable, Sendable, Equatable, Hashable, Identifiable {
    /// Its id on the computer; another computer gets it under a new one.
    public var id: String
    public var name: String
    public var size: Int64
    /// The copy's path inside the phone's attachment folder.
    public var local: String
    /// The computer that has some of it.
    public var computer: String?
    /// How much of it that computer has.
    public var received: Int64
    /// Where that computer keeps it, once all of it is there.
    public var path: String?

    public init(
        id: String = UUID().uuidString.lowercased(), name: String, size: Int64, local: String,
        computer: String? = nil, received: Int64 = 0, path: String? = nil
    ) {
        self.id = id
        self.name = name
        self.size = size
        self.local = local
        self.computer = computer
        self.received = received
        self.path = path
    }

    /// Done with on `computer`: there whole.
    public func uploaded(to computer: String) -> Bool { self.computer == computer && path != nil }

    /// Ready to go to `computer`: one another computer has some of starts over there under a new id.
    public func going(to computer: String) -> FileAttachment {
        guard let had = self.computer, had != computer else {
            var same = self
            same.computer = computer
            return same
        }
        return FileAttachment(name: name, size: size, local: local, computer: computer)
    }

    /// How far it got, 0...100.
    public var percent: Int {
        guard size > 0 else { return path == nil ? 0 : 100 }
        return Int((Double(min(received, size)) * 100 / Double(size)).rounded(.down))
    }
}

/// "820 B", "64 KB", "12.4 MB": a file's size as its card shows it, counted in 1024s.
public func fileSizeLabel(_ bytes: Int64) -> String {
    if bytes < 1024 { return "\(bytes) B" }
    if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded())) KB" }
    let mb = Double(bytes) / 1024 / 1024
    return mb < 100 ? String(format: "%.1f MB", mb) : "\(Int(mb.rounded())) MB"
}

/// `UploadedFile`: how much of the file the computer has; `path` once whole.
public struct UploadedFile: Codable, Sendable, Equatable {
    public var received: Int64
    public var path: String?

    public init(received: Int64, path: String? = nil) {
        self.received = received
        self.path = path
    }
}

/// The next bytes to send, from what the computer has: at most `chunk`, empty for an empty file.
public func nextChunk(size: Int64, received: Int64, chunk: Int = Files.chunk) -> Range<Int64> {
    let from = min(max(received, 0), size)
    return from..<min(size, from + Int64(chunk))
}

/// The message with its files after the text, each `` `path` `` on a line of its own.
public func bodyWithFiles(_ body: String, _ paths: [String]) -> String {
    let lines = paths.map { "`\($0)`" }
    guard !lines.isEmpty else { return body }
    let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
    return ([text].filter { !$0.isEmpty } + lines).joined(separator: "\n")
}

/// A piece of a sent message: what was typed, or a file Relay keeps for it, by its name.
public enum SentPiece: Equatable, Sendable {
    case text(String)
    case file(String)
}

/// `` `…/pastes/<id>/<name>` ``, a file a message took along.
nonisolated(unsafe) private let attachedPath = /`[^`\n]*[\\\/]pastes[\\\/][0-9a-f-]{36}[\\\/]([^\\\/`\n]+)`/

/// The message with the files it took along as their names; anything else stays text.
public func sentPieces(_ text: String) -> [SentPiece] {
    var pieces: [SentPiece] = []
    var rest = text[...]
    while let match = rest.firstMatch(of: attachedPath) {
        if match.range.lowerBound > rest.startIndex { pieces.append(.text(String(rest[..<match.range.lowerBound]))) }
        pieces.append(.file(String(match.output.1)))
        rest = rest[match.range.upperBound...]
    }
    if !rest.isEmpty { pieces.append(.text(String(rest))) }
    return pieces
}

/// What sends a file's chunks: the live link to a computer.
public protocol FileUploading: Sendable {
    func uploadFile(id: String, name: String, size: Int64, offset: Int64, data: String) async throws -> UploadedFile
}

/// Sends what `computer` doesn't have yet of `file`, read from `url`, carrying on from where it
/// says it is after each chunk. `progress` hears each step. Throws what the link throws.
@concurrent
public func upload(
    _ file: FileAttachment, from url: URL, to computer: String, via link: FileUploading,
    progress: @escaping @Sendable (FileAttachment) async -> Void = { _ in }
) async throws -> FileAttachment {
    var file = file.going(to: computer)
    guard file.path == nil else { return file }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var stalled = 0
    while file.path == nil {
        try Task.checkCancellation()
        let range = nextChunk(size: file.size, received: file.received)
        try handle.seek(toOffset: UInt64(range.lowerBound))
        let data = try handle.read(upToCount: range.count) ?? Data()
        guard data.count == range.count else { throw RemoteCallError.rejected("That file changed on this phone.") }
        let answer = try await link.uploadFile(
            id: file.id, name: file.name, size: file.size, offset: range.lowerBound, data: data.base64EncodedString())
        // A computer that takes nothing more from here would have it sent forever.
        stalled = answer.received > file.received || answer.path != nil ? 0 : stalled + 1
        guard stalled < 3 else { throw RemoteCallError.rejected("Your computer stopped taking the file.") }
        file.received = answer.received
        file.path = answer.path
        await progress(file)
    }
    return file
}

/// `work`, tried again after each of `delays` while it fails for a reason that may pass. A refusal,
/// or a cancelled task, isn't tried again.
public func retrying<T: Sendable>(
    isolation: isolated (any Actor)? = #isolation,
    _ delays: [Duration] = Files.retryDelays,
    sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
    _ work: () async throws -> T
) async throws -> T {
    var waits = delays[...]
    while true {
        do {
            return try await work()
        } catch {
            if case RemoteCallError.rejected = error { throw error }
            if error is CancellationError || Task.isCancelled { throw error }
            guard let wait = waits.popFirst() else { throw error }
            try await sleep(wait)
        }
    }
}

/// Where the phone keeps the files its messages take along, until the computer has them.
public struct FileFolder: Sendable {
    public let root: URL

    public init(root: URL) { self.root = root }

    public func url(_ file: FileAttachment) -> URL { root.appending(path: file.local) }

    /// A folder of its own for a new copy named `name`, and its path there.
    public func place(_ name: String) throws -> (url: URL, local: String) {
        let folder = UUID().uuidString.lowercased()
        let dir = root.appending(path: folder)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let clean = safeFileName(name)
        return (dir.appending(path: clean), "\(folder)/\(clean)")
    }

    public func remove(_ file: FileAttachment) {
        let dir = url(file).deletingLastPathComponent()
        guard dir.standardizedFileURL != root.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: dir)
    }

    /// Drops every copy but the ones `keeping` names.
    public func sweep(keeping: [FileAttachment]) {
        let kept = Set(keeping.compactMap { $0.local.split(separator: "/").first.map(String.init) })
        let folders = (try? FileManager.default.contentsOfDirectory(atPath: root.path(percentEncoded: false))) ?? []
        for folder in folders where !kept.contains(folder) {
            try? FileManager.default.removeItem(at: root.appending(path: folder))
        }
    }
}

/// A name that is one file name: no folders, not hidden, not empty.
public func safeFileName(_ name: String) -> String {
    let last = name.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
    let clean = last.trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
    return clean.isEmpty ? "attachment" : clean
}
