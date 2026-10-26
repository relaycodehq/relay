import Foundation

// shared/call-actions.ts CallAction and shared/projects/messages.ts WrittenCode. The desktop reads
// what a call did from its command; the phone takes `actions` as sent and never parses one.

/// What a tool call did, one of possibly several in a command line.
public enum CallAction: Sendable, Equatable {
    case read(file: String, lines: String?)
    case image(file: String)
    case search(pattern: String, place: String?)
    case edit(file: String)
    case create(file: String)
    case test(target: String?, failed: Bool)
    case check(name: String, failed: Bool)
    case commit(hash: String?, subject: String)
    case git(what: String)
    case run(what: String)
    case web(query: String)
    /// Anything with a row of its own: agents, questions, MCP tools.
    case tool

    /// The file it read or wrote, for the actions that have one.
    public var file: String? {
        switch self {
        case .read(let file, _), .image(let file), .edit(let file), .create(let file): file
        default: nil
        }
    }

    public var kind: String {
        switch self {
        case .read: "read"
        case .image: "image"
        case .search: "search"
        case .edit: "edit"
        case .create: "create"
        case .test: "test"
        case .check: "check"
        case .commit: "commit"
        case .git: "git"
        case .run: "run"
        case .web: "web"
        case .tool: "tool"
        }
    }
}

extension CallAction: Codable {
    private enum Key: String, CodingKey {
        case kind, file, lines, pattern, `where`, target, failed, name, hash, subject, what, query
    }

    /// Never throws: an action a newer desktop invents reads as a tool, which keeps its own row.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        func text(_ key: Key) -> String? { try? c.decodeIfPresent(String.self, forKey: key) }
        let failed = (try? c.decodeIfPresent(Bool.self, forKey: .failed)) ?? false
        switch text(.kind) {
        case "read": self = .read(file: text(.file) ?? "", lines: text(.lines))
        case "image": self = .image(file: text(.file) ?? "")
        case "search": self = .search(pattern: text(.pattern) ?? "", place: text(.where))
        case "edit": self = .edit(file: text(.file) ?? "")
        case "create": self = .create(file: text(.file) ?? "")
        case "test": self = .test(target: text(.target), failed: failed)
        case "check": self = .check(name: text(.name) ?? "check", failed: failed)
        case "commit": self = .commit(hash: text(.hash), subject: text(.subject) ?? "")
        case "git": self = .git(what: text(.what) ?? "git")
        case "run": self = .run(what: text(.what) ?? "command")
        case "web": self = .web(query: text(.query) ?? "")
        default: self = .tool
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(kind, forKey: .kind)
        switch self {
        case .read(let file, let lines):
            try c.encode(file, forKey: .file)
            try c.encodeIfPresent(lines, forKey: .lines)
        case .image(let file), .edit(let file), .create(let file):
            try c.encode(file, forKey: .file)
        case .search(let pattern, let place):
            try c.encode(pattern, forKey: .pattern)
            try c.encodeIfPresent(place, forKey: .where)
        case .test(let target, let failed):
            try c.encodeIfPresent(target, forKey: .target)
            try c.encode(failed, forKey: .failed)
        case .check(let name, let failed):
            try c.encode(name, forKey: .name)
            try c.encode(failed, forKey: .failed)
        case .commit(let hash, let subject):
            try c.encodeIfPresent(hash, forKey: .hash)
            try c.encode(subject, forKey: .subject)
        case .git(let what), .run(let what):
            try c.encode(what, forKey: .what)
        case .web(let query):
            try c.encode(query, forKey: .query)
        case .tool:
            break
        }
    }
}

/// What a call wrote into one file: all of it, the passages it swapped, or a patch.
/// `cut` when it ran past the desktop's limit and lost its end.
public enum WrittenCode: Sendable, Equatable {
    case whole(path: String, content: String, cut: Bool)
    case swap(path: String, edits: [SwappedText], cut: Bool)
    case patch(path: String, diff: String, cut: Bool)

    public var path: String {
        switch self {
        case .whole(let path, _, _), .swap(let path, _, _), .patch(let path, _, _): path
        }
    }

    public var cut: Bool {
        switch self {
        case .whole(_, _, let cut), .swap(_, _, let cut), .patch(_, _, let cut): cut
        }
    }
}

extension WrittenCode {
    /// Past the desktop's limit before any of it fit: only the path is left.
    public var keptNothing: Bool {
        switch self {
        case .whole(_, let content, let cut): cut && content.isEmpty
        case .patch(_, let diff, let cut): cut && diff.isEmpty
        case .swap(_, let edits, let cut): cut && edits.allSatisfy { $0.old.isEmpty && $0.new.isEmpty }
        }
    }
}

public struct SwappedText: Codable, Sendable, Equatable {
    public var old: String
    public var new: String

    public init(old: String, new: String) {
        self.old = old
        self.new = new
    }
}

extension WrittenCode: Decodable {
    private enum Key: String, CodingKey { case kind, path, content, edits, diff, cut }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let path = try c.decode(String.self, forKey: .path)
        let cut = (try? c.decodeIfPresent(Bool.self, forKey: .cut)) ?? false
        switch try c.decode(String.self, forKey: .kind) {
        case "whole": self = .whole(path: path, content: try c.decode(String.self, forKey: .content), cut: cut)
        case "swap": self = .swap(path: path, edits: try c.decode([SwappedText].self, forKey: .edits), cut: cut)
        case "patch": self = .patch(path: path, diff: try c.decode(String.self, forKey: .diff), cut: cut)
        case let kind: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "No written code \(kind).")
        }
    }
}

/// The last part of a path.
public func baseName(_ path: String) -> String {
    path.split(separator: "/").last.map(String.init) ?? path
}

/// The folder a file sits in, without the folders above it.
public func parentName(_ path: String) -> String {
    let parts = path.split(separator: "/")
    return parts.count > 1 ? String(parts[parts.count - 2]) : ""
}

/// Scratch files an agent writes for itself, outside any project.
func isScratch(_ path: String) -> Bool {
    path.hasPrefix("/tmp/") || path.hasPrefix("/private/tmp/")
}
