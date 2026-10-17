import Foundation

/// Threads kept for reading offline (mobile/src/remote/offline.ts, Android's
/// ThreadCache.kt): each paired computer keeps its own copies, the 20 most
/// recently saved, and the last few read stay in memory so reopening one draws
/// its first frame from it.
public final class ThreadCache: @unchecked Sendable {
    public static let keep = 20
    static let remembered = 8

    private let root: URL
    private let lock = NSLock()
    /// Newest last.
    private var memory: [(key: String, thread: RemoteChat)] = []

    public init(root: URL) {
        self.root = root
    }

    private func folder(_ computer: String) -> URL { root.appending(path: fileSafe(computer), directoryHint: .isDirectory) }
    private func file(_ computer: String, _ id: String) -> URL { folder(computer).appending(path: "thread-\(fileSafe(id)).json") }

    /// The saved copy, read at once: a thread's first frame needs it.
    public func now(_ computer: String?, _ id: String) -> RemoteChat? {
        guard let computer else { return nil }
        let url = file(computer, id)
        lock.lock()
        defer { lock.unlock() }
        if let at = memory.firstIndex(where: { $0.key == url.path }) {
            let held = memory.remove(at: at)
            memory.append(held)
            return held.thread
        }
        guard let data = try? Data(contentsOf: url), let thread = try? JSONDecoder().decode(RemoteChat.self, from: data)
        else { return nil }
        remember(url.path, thread)
        return thread
    }

    /// Whether the saved copy is missing or older than the thread's last change.
    public func stale(_ computer: String, _ id: String, updated: Int64) -> Bool {
        let path = file(computer, id).path
        guard let saved = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date else {
            return true
        }
        return Int64(saved.timeIntervalSince1970 * 1000) < updated
    }

    /// An unpaired computer's threads go with it.
    public func forget(_ computer: String) {
        let gone = folder(computer)
        lock.lock()
        defer { lock.unlock() }
        memory.removeAll { $0.key.hasPrefix(gone.path) }
        try? FileManager.default.removeItem(at: gone)
    }

    public func save(_ computer: String?, _ id: String, _ thread: RemoteChat) {
        guard let computer else { return }
        let url = file(computer, id)
        lock.lock()
        defer { lock.unlock() }
        remember(url.path, thread)
        do {
            try FileManager.default.createDirectory(at: folder(computer), withIntermediateDirectories: true)
            try JSONEncoder().encode(thread).write(to: url, options: .atomic)
            let keys: [URLResourceKey] = [.contentModificationDateKey]
            let saved = try FileManager.default.contentsOfDirectory(at: folder(computer), includingPropertiesForKeys: keys)
                .filter { $0.lastPathComponent.hasPrefix("thread-") && $0.pathExtension == "json" }
                .map { ($0, (try? $0.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast) }
                .sorted { $0.1 > $1.1 }
            for (old, _) in saved.dropFirst(Self.keep) { try? FileManager.default.removeItem(at: old) }
        } catch {}
    }

    private func remember(_ key: String, _ thread: RemoteChat) {
        memory.removeAll { $0.key == key }
        memory.append((key, thread))
        if memory.count > Self.remembered { memory.removeFirst(memory.count - Self.remembered) }
    }
}

/// A name that's safe as one path component.
func fileSafe(_ name: String) -> String {
    String(name.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." ? $0 : "_" })
}
