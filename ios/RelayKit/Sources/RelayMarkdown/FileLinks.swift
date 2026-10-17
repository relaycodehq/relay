import Foundation
import RelayRemote

// Port of shared/markdown-links.ts and shared/project-file-links.ts (Android's FileLinks.kt):
// whether a link destination or an inline code span names a file, from text alone.

/// `endLine` is the last line of a range like `:12-20`, after `line`.
public struct LinkPosition: Equatable, Sendable {
    public var path: String
    public var line: Int?
    public var column: Int?
    public var endLine: Int?

    public init(_ path: String, line: Int? = nil, column: Int? = nil, endLine: Int? = nil) {
        self.path = path
        self.line = line
        self.column = column
        self.endLine = endLine
    }
}

// `:12`, `:12:5`, or a range `:12-20`.
private let position = Pattern(#":([0-9]+)(?::([0-9]+)|[-–]([0-9]+))?$"#)
private let windowsAbsolute = Pattern(#"^[A-Za-z]:[/\\]"#)
private let explicitRelative = Pattern(#"^(?:~/|\./|\.\./)"#)
private let fileExtension = Pattern(#"\.[A-Za-z0-9_-]+$"#)
private let words = "[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*"
private let relativeWithDirectories = Pattern("^\(words)(?:/\(words))+(?::[0-9]+(?::[0-9]+|[-–][0-9]+)?)?$")
private let bareName = Pattern("^\(words)$")
private let numericHost = Pattern(#"^[0-9]+(?:\.[0-9]+)+$"#)
private let driveInPath = Pattern(#"^/[A-Za-z]:[/\\]"#)
private let lineAnchor = Pattern("^#L([0-9]+)(?:C([0-9]+))?(?:-L([0-9]+)(?:C[0-9]+)?)?$", [.caseInsensitive])
private let scheme = Pattern(#"^[A-Za-z][A-Za-z0-9+.-]*:([\s\S]*)$"#)
private let positionOnly = Pattern(#"^[0-9]+(?::[0-9]+|[-–][0-9]+)?$"#)

private func set(_ list: String) -> Set<String> { Set(list.split(separator: " ").map(String.init)) }

private let genericTLDs = set(
    "com net org io dev app ai co edu gov mil info biz xyz me tv cc gg chat cloud site online tech store link")

// Skipped when a position follows: `foo.pl:3` is a Perl file, not a host.
private let countryTLDs = set("uk de fr nl se no fi dk pl ch at be es it pt eu us ca au nz jp kr cn br ru mx ie cz tr sg hk")

private let osRoots = set(
    "Users home tmp var etc opt mnt Volumes private root usr bin sbin lib lib64 srv dev proc sys run boot media workspace workspaces"
).map { "/\($0)/" }

private let extensionlessFiles = set(
    "Makefile makefile GNUmakefile Dockerfile Containerfile Justfile justfile Rakefile Gemfile Procfile Brewfile Caddyfile Vagrantfile Jenkinsfile Podfile Fastfile BUILD WORKSPACE LICENSE LICENCE COPYING NOTICE AUTHORS CONTRIBUTORS CHANGELOG README CODEOWNERS"
)

private func segments(_ text: String, _ separator: Character = "/") -> [String] {
    text.split(separator: separator, omittingEmptySubsequences: false).map(String.init)
}

/// For an inline code span: a path-like string to feed to `resolveFileLink`, or nil.
/// Stricter than links, since inline code is mostly branches, hosts and prose.
public func filePathInInlineCode(_ code: String) -> String? {
    let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed.contains(where: { $0.isWhitespace || $0 == "`" }) { return nil }
    let text = windowsAbsolute.found(in: trimmed) ? trimmed : trimmed.replacingOccurrences(of: "\\", with: "/")
    let positioned = position.found(in: text)
    if !positioned && !text.contains("/") && !text.contains("\\") { return nil }
    if explicitRelative.found(in: text) || text.hasPrefix("/") || windowsAbsolute.found(in: text) { return text }
    let bare = position.replacing(in: text, with: "")
    if looksLikeHost(segments(bare)[0], positioned) { return nil }
    let last = segments(String(bare.reversed().drop { $0 == "/" }.reversed())).last ?? ""
    if !positioned && !fileExtension.found(in: last) { return nil }
    return text
}

private func looksLikeHost(_ segment: String, _ positioned: Bool) -> Bool {
    if segment.hasPrefix(".") { return false }
    if segment.lowercased() == "localhost" { return true }
    if numericHost.matches(segment) { return true }
    let labels = segments(segment, ".")
    if labels.count < 2 { return false }
    let tld = labels.last!.lowercased()
    return genericTLDs.contains(tld) || (!positioned && countryTLDs.contains(tld))
}

/// A link destination's path with any position split off, or nil when it isn't a file path.
public func resolveFileLink(_ href: String) -> LinkPosition? {
    var destination = href.trimmingCharacters(in: .whitespacesAndNewlines)
    if destination.count >= 2 && destination.hasPrefix("<") && destination.hasSuffix(">") {
        destination = String(destination.dropFirst().dropLast())
    }
    if destination.isEmpty || destination.hasPrefix("#") || destination.hasPrefix("//") { return nil }

    let split =
        destination.lowercased().hasPrefix("file:")
        ? splitFileURL(String(destination.dropFirst(5))) : splitPathAndHash(destination)
    guard let split else { return nil }

    var path = decode(split.path.trimmingCharacters(in: .whitespacesAndNewlines))
    let hash = decode(split.hash.trimmingCharacters(in: .whitespacesAndNewlines))
    if driveInPath.found(in: path) { path.removeFirst() }
    if path.isEmpty || isExternal(path) { return nil }

    let written = path
    let line: Int?
    var column: Int?
    var endLine: Int?
    if let suffix = position.first(in: path) {
        path = String(path[..<suffix.range.lowerBound])
        line = positive(suffix.groups[0])
        column = positive(suffix.groups[1])
        endLine = positive(suffix.groups[2])
    } else {
        let anchor = lineAnchor.first(in: hash)
        line = positive(anchor?.groups[0])
        column = positive(anchor?.groups[1])
        endLine = positive(anchor?.groups[2])
    }
    if !isFilePath(path, written: written) { return nil }
    // A column means nothing without its line; a backwards or one-line range is just its first line.
    if line == nil { column = nil }
    if let line, let end = endLine, end > line {} else { endLine = nil }
    return LinkPosition(path, line: line, column: column, endLine: endLine)
}

private func splitPathAndHash(_ destination: String) -> (path: String, hash: String) {
    let hashAt = destination.firstIndex(of: "#")
    let beforeHash = hashAt.map { String(destination[..<$0]) } ?? destination
    let path = beforeHash.firstIndex(of: "?").map { String(beforeHash[..<$0]) } ?? beforeHash
    return (path, hashAt.map { String(destination[$0...]) } ?? "")
}

/// `rest` is a file URL after its scheme; only local hosts are files.
private func splitFileURL(_ rest: String) -> (path: String, hash: String)? {
    let local: String
    if rest.hasPrefix("//") {
        let authority = rest.dropFirst(2)
        let hostEnd = authority.firstIndex { $0 == "/" || $0 == "?" || $0 == "#" }
        let host = hostEnd.map { authority[..<$0] } ?? authority
        if !host.isEmpty && host.lowercased() != "localhost" { return nil }
        local = hostEnd.map { String(authority[$0...]) } ?? ""
    } else if rest.hasPrefix("/") {
        local = rest
    } else {
        return nil
    }
    let split = splitPathAndHash(local)
    if !split.path.hasPrefix("/") { return nil }
    return (removeDotSegments(split.path), split.hash)
}

/// What a browser does to a URL's path: `.` drops out, `..` eats its parent.
private func removeDotSegments(_ path: String) -> String {
    var out: [String] = []
    let parts = segments(path)
    for (i, segment) in parts.enumerated() {
        let last = i == parts.count - 1
        if segment == "." || segment == ".." {
            if segment == ".." && out.count > 1 { out.removeLast() }
            if last { out.append("") }
        } else {
            out.append(segment)
        }
    }
    return out.joined(separator: "/")
}

/// decodeURIComponent, keeping the text as is where that would throw.
func decode(_ text: String) -> String {
    guard text.contains("%") else { return text }
    return text.removingPercentEncoding ?? text
}

/// A URL scheme, unless what follows the colon is a drive path or a position.
private func isExternal(_ path: String) -> Bool {
    guard let match = scheme.first(in: path) else { return false }
    let rest = match.groups[0] ?? ""
    if windowsAbsolute.found(in: path) { return false }
    if rest.hasPrefix("//") { return true }
    return !positionOnly.matches(rest)
}

/// Lines and columns beyond range are noise, not positions.
private func positive(_ digits: String?) -> Int? {
    guard let digits, !digits.isEmpty, let n = Int(digits), n > 0 else { return nil }
    return n
}

/// `path` has its position removed, `written` still carries it.
private func isFilePath(_ path: String, written: String) -> Bool {
    if windowsAbsolute.found(in: path) || explicitRelative.found(in: path) { return true }
    if path.hasPrefix("/") {
        let last = segments(written).last ?? ""
        return osRoots.contains { written.hasPrefix($0) } || position.found(in: written)
            || extensionlessFiles.contains(last) || fileExtension.found(in: last)
    }
    if extensionlessFiles.contains(path) { return true }
    return relativeWithDirectories.matches(written) || (bareName.matches(path) && fileExtension.found(in: path))
}

public struct ProjectFileLink: Equatable, Sendable {
    public var path: String
    public var line: Int?
    public var directory: Bool

    public init(_ path: String, line: Int? = nil, directory: Bool) {
        self.path = path
        self.line = line
        self.directory = directory
    }
}

/// Whether a link names this file, or a folder that contains it.
public func linksTo(_ link: ProjectFileLink, _ path: String) -> Bool {
    link.directory ? path.hasPrefix(link.path + "/") : path == link.path
}

private func validFilePath(_ v: String) -> Bool {
    !v.isEmpty && v.utf16.count <= 4096 && !v.hasPrefix("/") && !v.contains("\u{0}")
        && !segments(v).contains { $0 == ".." || $0 == "." }
}

/// File links and inline code paths inside the thread's folder, never outside it.
public func projectFileLink(_ value: String, root: String, inline: Bool = false) -> ProjectFileLink? {
    let candidate = inline ? filePathInInlineCode(value) : value
    // A trailing slash is clear enough for the folder browser.
    let directoryCandidate =
        inline && value.hasSuffix("/") && !value.contains("://")
            && !value.contains(where: { $0.isWhitespace || "`?#".contains($0) }) ? value : nil
    guard let target = candidate.flatMap(resolveFileLink) ?? directoryCandidate.map({ LinkPosition($0) }),
        !root.isEmpty
    else { return nil }
    let normalizedRoot = String(root.reversed().drop { $0 == "/" }.reversed())
    var path = target.path.replacingOccurrences(of: "\\", with: "/")
    if path.hasPrefix("/") {
        guard path.hasPrefix(normalizedRoot + "/") else { return nil }
        path = String(path.dropFirst(normalizedRoot.count + 1))
    } else if path.hasPrefix("~/") {
        return nil
    }
    while path.hasPrefix("./") { path = String(path.dropFirst(2)) }
    let directory = path.hasSuffix("/")
    while path.hasSuffix("/") { path.removeLast() }
    guard validFilePath(path) else { return nil }
    return ProjectFileLink(path, line: target.line, directory: directory)
}

/// The paths a link names: exact hits, else paths that end with it (`name.ts:33`).
public func matchLink(_ link: ProjectFileLink, _ paths: [String]) -> [String] {
    let exact = paths.filter { linksTo(link, $0) }
    if !exact.isEmpty || link.directory { return exact }
    return paths.filter { $0.hasSuffix("/" + link.path) }
}

/// What a link or inline code in an answer opens.
public enum FileLinkTarget: Equatable, Sendable {
    case diff(TurnFileChange)
    case file(String)
    case folder(String)
}

/// The diff of a file the answer's turn changed, else the file or folder as it is. Paths
/// outside `root` stay text. A bare `cache.ts:33` opens the one change it names.
public func fileLinkTarget(_ value: String, inline: Bool, root: String, changes: [TurnFileChange] = [])
    -> FileLinkTarget?
{
    guard let link = projectFileLink(value, root: root, inline: inline) else { return nil }
    if link.directory { return .folder(link.path) }
    let changed = matchLink(link, changes.map(\.path))
    if changed.count == 1, let change = changes.first(where: { $0.path == changed[0] }) { return .diff(change) }
    return .file(link.path)
}

/// An ICU pattern as Java's reads it, for the ports of the Kotlin app's regexes.
struct Pattern: Sendable {
    let regex: NSRegularExpression

    init(_ pattern: String, _ options: NSRegularExpression.Options = []) {
        regex = try! NSRegularExpression(pattern: pattern, options: options)
    }

    struct Match {
        let range: Range<String.Index>
        /// Capture groups from 1; nil where one didn't take part.
        let groups: [String?]
    }

    func found(in text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// The whole of `text` matches.
    func matches(_ text: String) -> Bool {
        let all = NSRange(text.startIndex..., in: text)
        return regex.firstMatch(in: text, options: [.anchored], range: all)?.range == all
    }

    func first(in text: String) -> Match? {
        guard let m = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
            let range = Range(m.range, in: text)
        else { return nil }
        let groups = (1..<max(1, m.numberOfRanges)).map { i in Range(m.range(at: i), in: text).map { String(text[$0]) } }
        return Match(range: range, groups: groups + Array(repeating: nil, count: max(0, 3 - groups.count)))
    }

    func replacing(in text: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
}
