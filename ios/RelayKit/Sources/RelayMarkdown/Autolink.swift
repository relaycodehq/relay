import Foundation

// Bare web addresses and emails in an answer's text are links, as commonmark's autolink
// extension makes them on Android: http(s)://, ftp:// and www. addresses, then emails.

private let address = try! NSRegularExpression(
    pattern: #"(?:\b(?:https?|ftp)://|\bwww\.)[^\s<]+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b"#,
    options: [.caseInsensitive])

/// `text` cut into what's plain and what's an address, with the URL each address opens.
func autolinked(_ text: String) -> [(String, URL?)] {
    let ns = text as NSString
    var out: [(String, URL?)] = []
    var at = 0
    for match in address.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        let found = trimmed(ns.substring(with: match.range))
        guard let url = linkURL(found) else { continue }
        if match.range.location > at { out.append((ns.substring(with: NSRange(location: at, length: match.range.location - at)), nil)) }
        out.append((found, url))
        at = match.range.location + (found as NSString).length
    }
    if at < ns.length { out.append((ns.substring(from: at), nil)) }
    return out
}

/// An address without what ends the sentence around it: trailing punctuation, and a `)` it didn't open.
private func trimmed(_ found: String) -> String {
    var s = Substring(found)
    while let last = s.last {
        if "?!.,:;*_~'\"".contains(last) {
            s.removeLast()
        } else if last == ")", s.filter({ $0 == ")" }).count > s.filter({ $0 == "(" }).count {
            s.removeLast()
        } else {
            break
        }
    }
    return String(s)
}

private func linkURL(_ found: String) -> URL? {
    if found.contains("://") { return URL(string: found) }
    if found.lowercased().hasPrefix("www.") { return URL(string: "http://" + found) }
    return found.contains("@") ? URL(string: "mailto:" + found) : nil
}
