import Foundation

// Ports of shared/answer-images.ts, the image half of shared/agent-trace.ts and
// the Kotlin app's MessageImageList.kt.

/// Where a picture comes from.
public enum ImageSource: Hashable, Sendable {
    case attached(chatId: String, imageId: String)
    case read(chatId: String, messageId: String, path: String)
    /// The preview's last frame a turn kept; only desktops from `Bridge.preview` hand it out.
    case preview(chatId: String, messageId: String)

    var wire: JSON {
        switch self {
        case .attached(let chatId, let imageId):
            ["kind": "attached", "chatId": .string(chatId), "imageId": .string(imageId)]
        case .read(let chatId, let messageId, let path):
            ["kind": "read", "chatId": .string(chatId), "messageId": .string(messageId), "path": .string(path)]
        case .preview(let chatId, let messageId):
            ["kind": "preview", "chatId": .string(chatId), "messageId": .string(messageId)]
        }
    }
}

public struct MessageImage: Hashable, Sendable {
    public var source: ImageSource
    public var name: String

    public init(source: ImageSource, name: String) {
        self.source = source
        self.name = name
    }
}

/// An image Relay can show, by its name.
public func isImagePath(_ path: String) -> Bool {
    path.range(of: #"\.(?:png|jpe?g|gif|webp)$"#, options: [.regularExpression, .caseInsensitive]) != nil
}

// A destination in <angle brackets> may hold spaces, like a macOS app data
// path. Agents often leave the brackets out, so a bare one with spaces counts
// too when it ends in a file Relay shows.
private let markdownImage = try! NSRegularExpression(
    pattern:
        #"!\[[^\]\n]*]\(\s*(?:<([^<>\n]+)>|([^\s<>()]+)|([^\s<>()][^<>()\n]*?\.(?:png|jpe?g|gif|webp|mp4|m4v|webm|mov)))(?:\s+["'][^"'\n]*["'])?\s*\)"#,
    options: .caseInsensitive)
private let fenceOpen = try! NSRegularExpression(pattern: "^[ \t>]*(`{3,}|~{3,})")
private let codeSpan = try! NSRegularExpression(pattern: "`+[^`]*`+")

private func matches(_ text: String, _ pattern: String) -> Bool {
    text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
}

/// The image file `src` of an answer's `![alt](src)` points at, or nil when it isn't one on
/// that computer. Relative paths resolve against the thread's folder.
public func localImagePath(_ src: String, root: String) -> String? {
    var path = src.trimmingCharacters(in: .whitespacesAndNewlines)
    let drive = #"^[a-z]:[\\/]"#
    if matches(path, "^file://") {
        guard let raw = URLComponents(string: path)?.percentEncodedPath, let decoded = raw.removingPercentEncoding
        else { return nil }
        path = decoded
    } else if matches(path, #"^[a-z][a-z\d+.-]*:"#) && !matches(path, drive) {
        // http:, data: and the like; a Windows drive letter isn't a scheme.
        return nil
    } else {
        guard let decoded = path.contains("%") ? path.removingPercentEncoding : path else { return nil }
        path = decoded
    }
    if matches(path, drive) { return isImagePath(path) ? path : nil }
    var parts: [String] = []
    for part in (path.hasPrefix("/") ? path : "\(root)/\(path)").split(separator: "/", omittingEmptySubsequences: true) {
        if part == ".." {
            _ = parts.popLast()
        } else if part != "." {
            parts.append(String(part))
        }
    }
    let full = "/" + parts.joined(separator: "/")
    return isImagePath(full) ? full : nil
}

/// The local image files an answer embeds, so only those can be read for it.
public func answerImagePaths(_ body: String, root: String) -> [String] {
    let text = body as NSString
    var seen = Set<String>()
    return markdownImage.matches(in: body, range: NSRange(location: 0, length: text.length)).compactMap { match in
        let found = (1...3).map { match.range(at: $0) }.first { $0.location != NSNotFound }!
        let src = text.substring(with: found)
        guard let path = localImagePath(src, root: root),
            seen.insert(path).inserted
        else { return nil }
        return path
    }
}

/// Puts angle brackets around an image path with spaces, so the Markdown parser reads
/// `![shot](/Library/Application Support/shot.png)` as an image and not as text. Code
/// fences and code spans are left as they are.
public func bracketSpacedImagePaths(_ text: String) -> String {
    guard text.contains("![") else { return text }
    var fence: NSRegularExpression?
    return text.components(separatedBy: "\n").map { line in
        let whole = NSRange(location: 0, length: (line as NSString).length)
        if let closing = fence {
            if closing.firstMatch(in: line, range: whole) != nil { fence = nil }
            return line
        }
        if let open = fenceOpen.firstMatch(in: line, range: whole) {
            let marker = (line as NSString).substring(with: open.range(at: 1))
            fence = try? NSRegularExpression(pattern: "^[ \\t>]*\(marker.prefix(1)){\(marker.count),}[ \\t]*$")
            return line
        }
        return outsideCodeSpans(line, bracketSpaced)
    }.joined(separator: "\n")
}

private func outsideCodeSpans(_ line: String, _ change: (String) -> String) -> String {
    let text = line as NSString
    var out = "", from = 0
    for span in codeSpan.matches(in: line, range: NSRange(location: 0, length: text.length)) {
        out += change(text.substring(with: NSRange(location: from, length: span.range.location - from)))
        out += text.substring(with: span.range)
        from = NSMaxRange(span.range)
    }
    return out + change(text.substring(from: from))
}

private func bracketSpaced(_ part: String) -> String {
    let text = NSMutableString(string: part)
    let images = markdownImage.matches(in: part, range: NSRange(location: 0, length: text.length))
    // Back to front, so an insertion doesn't move the ranges still to come.
    for match in images.reversed() where match.range(at: 3).location != NSNotFound {
        let spaced = match.range(at: 3)
        text.insert(">", at: NSMaxRange(spaced))
        text.insert("<", at: spaced.location)
    }
    return text as String
}

/// The picture a call looked at or made, by path.
public func imagePath(_ a: AgentActivity) -> String? {
    a.image ?? (a.kind == "read" && isImagePath(a.label) ? a.label : nil)
}

/// A call that looks at or made an image Relay can show; it's still running or done.
public func looksAtImage(_ a: AgentActivity) -> Bool {
    (a.status == "running" || a.status == "complete") && imagePath(a) != nil
}

/// The images a turn's calls read, once each, in order.
public func turnImages(_ message: ChatMessage) -> [String] {
    let calls = message.trace.map { $0.compactMap(\.activity) } ?? message.activity ?? []
    var seen = Set<String>()
    return calls.compactMap { a in
        guard a.status == "complete", let path = imagePath(a), seen.insert(path).inserted else { return nil }
        return path
    }
}

/// Every image of a message, in the order the lightbox steps through them: pasted ones,
/// those its answer shows (under `root`), then, once the turn ends, the rest its agent read.
public struct MessageImages: Equatable, Sendable {
    public var all: [MessageImage]
    /// Pasted ones: the row's share while the open trace shows the read ones under their calls.
    public var pasted: [MessageImage]
    /// The pasted and the unshown read ones, for the row under the message.
    public var strip: [MessageImage]
    /// What the agent has looked at so far, which its trace rows open among.
    public var looked: [MessageImage]

    public init(chatId: String, message: ChatMessage, root: String?) {
        func read(_ path: String) -> MessageImage {
            MessageImage(source: .read(chatId: chatId, messageId: message.id, path: path), name: fileName(path))
        }
        pasted = (message.images ?? []).map {
            MessageImage(source: .attached(chatId: chatId, imageId: $0.id), name: $0.name)
        }
        let shown = message.role == "assistant" ? root.map { answerImagePaths(message.body, root: $0) } ?? [] : []
        let turn = turnImages(message)
        let unshown = message.streaming ? [] : turn.filter { !shown.contains($0) }.map(read)
        all = pasted + (message.streaming ? [] : shown.map(read)) + unshown
        strip = pasted + unshown
        looked = turn.map(read)
    }
}

public extension RemoteClient {
    /// The picture as a data URL, `max` pixels at most on its longer side. From `Bridge.image`;
    /// older desktops send pasted and read ones whole through `whole`.
    func image(_ source: ImageSource, max: Int) async throws -> String {
        let url = try await call("image", [source.wire, .number(Double(min(Swift.max(max, 16), 4096)))])
        guard let text = url.string else { throw RemoteCallError.rejected("Not an image.") }
        return text
    }

    /// Before `Bridge.image`: the picture whole. A preview's frame comes only through `image`.
    func wholeImage(_ source: ImageSource) async throws -> String {
        let url: JSON
        switch source {
        case .attached(let chatId, let imageId):
            url = try await desktop("projectChatImage", [.string(chatId), .string(imageId)])
        case .read(let chatId, let messageId, let path):
            url = try await desktop("projectChatReadImage", [.string(chatId), .string(messageId), .string(path)])
        case .preview:
            throw RemoteCallError.rejected("This computer's Relay keeps no preview frames.")
        }
        guard let text = url.string else { throw RemoteCallError.rejected("Not an image.") }
        return text
    }
}
