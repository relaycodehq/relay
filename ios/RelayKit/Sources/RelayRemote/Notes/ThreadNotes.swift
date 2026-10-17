import Foundation

// shared/thread-notes.ts on a phone (Android's NoteLists.kt): what the user keeps at hand in a
// thread. A note that is a list ticks off, and only its unfinished part goes into a message.

/// `shared/thread-notes.ts` ThreadNote. From `Bridge.notes`.
public struct ThreadNote: Codable, Sendable, Equatable, Identifiable {
    /// `n1`, `n2`…
    public var id: String
    /// Markdown, as kept.
    public var text: String
    /// A list note's ticked items, by their index from 0.
    public var done: [Int]?
    /// The message it was kept from.
    public var from: String?
    /// A pin on the whole message `from`; `text` is only its label.
    public var ref: Bool?
    /// The agent that kept it; nil when the user did.
    public var by: String?
    public var created: Int64
    public var updated: Int64

    public init(
        id: String, text: String, done: [Int]? = nil, from: String? = nil, ref: Bool? = nil, by: String? = nil,
        created: Int64, updated: Int64
    ) {
        self.id = id
        self.text = text
        self.done = done
        self.from = from
        self.ref = ref
        self.by = by
        self.created = created
        self.updated = updated
    }
}

/// `3.` for a numbered item, empty for a bullet; `text` is its markdown, nested lines unindented.
public struct NoteItem: Equatable, Sendable {
    public var number: String
    public var text: String

    public init(_ number: String, _ text: String) {
        self.number = number
        self.text = text
    }
}

public struct NoteList: Equatable, Sendable {
    public var lead: String
    public var items: [NoteItem]

    public init(lead: String, items: [NoteItem]) {
        self.lead = lead
        self.items = items
    }
}

private let item = try! NSRegularExpression(pattern: #"^ {0,3}(?:[-*+]|([0-9]{1,9})[.)])[ \t]+(.*)$"#)
private let fence = try! NSRegularExpression(pattern: #"^ {0,3}(`{3,}|~{3,})"#)

private func groups(_ regex: NSRegularExpression, _ line: String) -> [String]? {
    guard let m = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else { return nil }
    return (1..<m.numberOfRanges).map { i in Range(m.range(at: i), in: line).map { String(line[$0]) } ?? "" }
}

private func trimmedEnd(_ s: String) -> String { String(s.reversed().drop(while: \.isWhitespace).reversed()) }

/// The note as a list to tick off, when it is one: optional lines leading into a single
/// top-level list with nothing after it.
public func noteList(_ text: String) -> NoteList? {
    let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let lines = trimmedEnd(normalized).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    var open: String?
    var start = -1
    for (index, line) in lines.enumerated() {
        let opening = groups(fence, line)?[0]
        if let o = open {
            if let opening, opening.first == o.first, opening.count >= o.count { open = nil }
            continue
        }
        if let opening {
            open = opening
            continue
        }
        if groups(item, line) != nil {
            start = index
            break
        }
    }
    if start < 0 { return nil }
    var items: [NoteItem] = []
    // Where the current item's text starts; lines indented that far are its own.
    var column = 0
    var blank = false
    for raw in lines[start...] {
        let line = raw.replacingOccurrences(of: "\t", with: "    ")
        let indent = line.prefix { $0 == " " }.count
        let found = groups(item, line)
        if line.allSatisfy(\.isWhitespace) {
            blank = true
        } else if !items.isEmpty && indent >= column {
            items[items.count - 1].text += "\n" + (blank ? "\n" : "") + line.dropFirst(min(column, line.count))
            blank = false
        } else if let found {
            items.append(NoteItem(found[0].isEmpty ? "" : "\(found[0]).", found[1]))
            column = line.count - found[1].count
            blank = false
        } else if !blank {
            // A lazy line right under an item still belongs to it.
            items[items.count - 1].text += "\n" + line.trimmingCharacters(in: .whitespaces)
        } else {
            return nil
        }
    }
    let lead = lines[..<start].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return NoteList(lead: lead, items: items)
}

/// Markdown for the draft: only unfinished work, or one unfinished item (`index` from 0).
public func noteQuote(_ note: ThreadNote, index: Int? = nil) -> String {
    if note.ref == true { return index == nil ? note.text : "" }
    guard let list = noteList(note.text) else { return index == nil ? note.text : "" }
    let done = Set(note.done ?? [])
    let remaining = list.items.enumerated().filter { i, _ in !done.contains(i) && (index == nil || index == i) }
        .map(\.element)
    if remaining.isEmpty { return "" }
    if index == nil && remaining.count == list.items.count { return note.text }
    let items = remaining.map(itemMarkdown)
    return ([index == nil ? list.lead : ""] + items).filter { !$0.isEmpty }.joined(separator: "\n\n")
}

private func itemMarkdown(_ item: NoteItem) -> String {
    let marker = "\(item.number.isEmpty ? "-" : item.number) "
    return item.text.split(separator: "\n", omittingEmptySubsequences: false).enumerated().map { i, line in
        i == 0 ? marker + line : line.isEmpty ? "" : String(repeating: " ", count: marker.count) + line
    }.joined(separator: "\n")
}

/// What the thread's summary says of these notes, so the phone's own change needs no fetch.
public func notesMark(_ notes: [ThreadNote]) -> String? {
    guard let latest = notes.map(\.updated).max() else { return nil }
    return "\(notes.count).\(latest)"
}

/// The item (`index` from 0) ticked or unticked here, before the computer says so.
public func ticked(_ notes: [ThreadNote], id: String, index: Int, done: Bool) -> [ThreadNote] {
    notes.map { n in
        guard n.id == id else { return n }
        var set = Set(n.done ?? [])
        if done { set.insert(index) } else { set.remove(index) }
        var next = n
        next.done = set.isEmpty ? nil : set.sorted()
        return next
    }
}

public extension RemoteClient {
    func threadNotes(chatId: String) async throws -> [ThreadNote] {
        try await desktop("threadNotes", [.string(chatId)]).decode()
    }

    /// Ticks item `index` (from 0) of a list note, or unticks it; the notes after.
    func tickThreadNote(chatId: String, noteId: String, index: Int, done: Bool) async throws -> [ThreadNote] {
        try await desktop("tickThreadNote", [.string(chatId), .string(noteId), .number(Double(index + 1)), .bool(done)])
            .decode()
    }

    func removeThreadNote(chatId: String, noteId: String) async throws -> [ThreadNote] {
        try await desktop("removeThreadNote", [.string(chatId), .string(noteId)]).decode()
    }
}
