import Foundation

// shared/composer-quotes.ts (Android's Quotes.kt): a quoted passage travels in
// the draft as a Markdown blockquote.

/// Every line prefixed, then a blank line.
public func quoteMarkdown(_ text: String) -> String {
    text.split(separator: "\n", omittingEmptySubsequences: false).map { "> \($0)" }.joined(separator: "\n") + "\n\n"
}

/// The start of a message to quote from a phone: its first `lines` lines and at
/// most `chars` characters, ending in " …" where it was cut.
public func quoteExcerpt(_ text: String, lines: Int = 8, chars: Int = 600) -> String {
    let whole = text.replacing(#/\r\n?/#, with: "\n").replacing(#/^\n+|\s+$/#, with: "")
    var cut = whole.split(separator: "\n", omittingEmptySubsequences: false).prefix(lines).joined(separator: "\n")
    // Counted in UTF-16 as the desktop does; a pair cut in half goes.
    if cut.utf16.count > chars {
        var head = String(decoding: cut.utf16.prefix(chars), as: UTF16.self)
        if head.last == "\u{FFFD}" { head.removeLast() }
        cut = head.replacing(#/\s+\S*$/#, with: "")
    }
    while let last = cut.last, last.isWhitespace { cut.removeLast() }
    let truncated = cut.utf16.count < whole.utf16.count
    // Close a fenced code block before the truncation mark, nested quotes too.
    var fence: (marker: String, prefix: String)?
    for line in cut.split(separator: "\n", omittingEmptySubsequences: false) {
        guard let m = line.wholeMatch(of: #/((?: {0,3}> ?)* {0,3})(`{3,}|~{3,})(.*)/#) else { continue }
        let (prefix, marker, rest) = (String(m.output.1), String(m.output.2), m.output.3)
        if let open = fence {
            if marker.first == open.marker.first, marker.count >= open.marker.count,
                rest.allSatisfy(\.isWhitespace)
            {
                fence = nil
            }
        } else {
            fence = (marker, prefix)
        }
    }
    if let fence { return "\(cut)\n\(fence.prefix)\(fence.marker)\(truncated ? "\n\n…" : "")" }
    return truncated ? "\(cut) …" : cut
}

/// The quote after what's typed, with a blank line between.
public func appendQuote(_ draft: String, _ markdown: String) -> String {
    let typed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !typed.isEmpty else { return markdown }
    var kept = draft
    while let last = kept.last, last.isWhitespace { kept.removeLast() }
    return "\(kept)\n\n\(markdown)"
}
