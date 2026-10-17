import Foundation

// Android's MathDelimiters.kt, a port of shared/math-delimiters.ts.

/// Agents write math as `$$…$$`, `\[…\]`, `\(…\)` and `$…$`; this rewrites them
/// all into the one `markdownBlocks` knows: a display formula becomes a `$$`
/// line, its lines, a `$$` line; an inline one becomes `$$x$$`. `$x$` follows
/// Pandoc's rule (no space inside, no digit after the closer), so prices stay
/// prose. Code is left alone; idempotent.
public func normalizeMath(_ text: String) -> String {
    guard hasMath(text) else { return text }
    let lines = text.components(separatedBy: "\n")
    var out: [String] = []
    out.reserveCapacity(lines.count)
    var fence: Fence?
    var i = 0
    while i < lines.count {
        let line = lines[i]
        if let open = fence {
            out.append(line)
            if open.closes(line) { fence = nil }
            i += 1
            continue
        }
        if let open = Fence(opening: line) {
            fence = open
            out.append(line)
            i += 1
            continue
        }
        if case let (display, last)? = displayMath(lines, from: i) {
            out += display
            i = last + 1
            continue
        }
        out.append(inlineMath(line))
        i += 1
    }
    return out.joined(separator: "\n")
}

private func hasMath(_ text: String) -> Bool {
    text.unicodeScalars.contains("$") || text.contains("\\(") || text.contains("\\[")
}

private func isPrefix(_ c: Character) -> Bool { c == " " || c == "\t" || c == ">" }

private func stripPrefix(_ line: some StringProtocol) -> Substring { Substring(line).drop(while: isPrefix) }

private func isBlank(_ text: some StringProtocol) -> Bool { text.allSatisfy(\.isWhitespace) }

private func trimmed(_ text: some StringProtocol) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

private func trimmedEnd(_ text: some StringProtocol) -> Substring {
    var out = Substring(text)
    while out.last?.isWhitespace == true { out.removeLast() }
    return out
}

/// A code fence: a line of at least `count` of its `mark`s, after quote marks and indent, closes it.
struct Fence {
    let mark: Character
    let count: Int

    init?(opening line: String) {
        let rest = stripPrefix(line)
        guard let mark = rest.first, mark == "`" || mark == "~" else { return nil }
        let count = rest.prefix(while: { $0 == mark }).count
        guard count >= 3 else { return nil }
        self.mark = mark
        self.count = count
    }

    func closes(_ line: String) -> Bool {
        let rest = stripPrefix(line)
        let run = rest.prefix(while: { $0 == mark }).count
        return run >= count && rest.dropFirst(run).allSatisfy { $0 == " " || $0 == "\t" }
    }
}

/// A formula taking whole lines from `lines[from]`, rewritten, with its last line's index.
private func displayMath(_ lines: [String], from: Int) -> ([String], Int)? {
    let line = lines[from]
    let body = stripPrefix(line)
    let prefix = String(line[..<body.startIndex])
    let opener: String
    if body.hasPrefix("$$") {
        opener = "$$"
    } else if body.hasPrefix("\\[") {
        opener = "\\["
    } else {
        return nil
    }
    let rest = body.dropFirst(2)
    let closer = opener == "$$" ? "$$" : "\\]"
    let fence = prefix + "$$"

    if let end = rest.range(of: closer) {
        // Text after the closer makes it part of a sentence.
        if !isBlank(rest[end.upperBound...]) { return nil }
        let formula = trimmed(rest[..<end.lowerBound])
        return (formula.isEmpty ? [fence, fence] : [fence, prefix + formula, fence], from)
    }

    var last = from + 1
    while last < lines.count && !trimmedEnd(stripPrefix(lines[last])).hasSuffix(closer) { last += 1 }
    let closes = last < lines.count
    if !closes && opener != "$$" && !isBlank(rest) { return nil }
    // Still streaming in: the formula runs to the end of what has arrived.
    if !closes && !isBlank(rest) { return ([prefix + "\\$$" + rest], from) }

    var out = [fence]
    if !isBlank(rest) { out.append(prefix + trimmed(rest)) }
    if !closes { return (out + lines[(from + 1)...], lines.count - 1) }
    out += lines[(from + 1)..<last]
    let tail = trimmedEnd(stripPrefix(lines[last]))
    let formula = trimmed(tail.dropLast(closer.count))
    if !formula.isEmpty { out.append(prefix + formula) }
    out.append(fence)
    return (out, last)
}

private let codeSpan = try! NSRegularExpression(pattern: "(`+)(?:[^`]|[^`].*?[^`])\\1(?!`)")

private func inlineMath(_ line: String) -> String {
    guard hasMath(line) else { return line }
    var out = ""
    var at = line.startIndex
    for span in codeSpan.matches(in: line, range: NSRange(line.startIndex..., in: line)) {
        guard let range = Range(span.range, in: line) else { continue }
        out += convertInline(String(line[at..<range.lowerBound])) + line[range]
        at = range.upperBound
    }
    return out + convertInline(String(line[at...]))
}

private let proseEscapes = try! NSRegularExpression(pattern: #"\\[dDwWsSbBntr](?![A-Za-z])|\\[.*+?()|/\[\]-]"#)
private let counts = try! NSRegularExpression(pattern: #"\{\d+(?:,\d*)?\}"#)

/// `\[x\]` is also how prose escapes brackets, so it needs a formula's look.
private func formulaLook(_ tex: String) -> Bool {
    let bare = removing(counts, from: removing(proseEscapes, from: tex))
    return bare.contains { "\\^_={}".contains($0) }
}

private func removing(_ regex: NSRegularExpression, from text: String) -> String {
    regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
}

private let parens = try! NSRegularExpression(pattern: #"\\\(\s*(.+?)\s*\\\)"#)
private let brackets = try! NSRegularExpression(pattern: #"\\\[\s*(.+?)\s*\\]"#)

private func convertInline(_ text: String) -> String {
    let inParens = replacing(parens, in: text) { _, formula in "$$" + formula + "$$" }
    let inBrackets = replacing(brackets, in: inParens) { whole, formula in
        formulaLook(formula) ? "$$" + formula + "$$" : whole
    }
    return pandocDollars(inBrackets)
}

/// `text` with each match of `regex` replaced by what `replace` makes of it and its first group.
private func replacing(_ regex: NSRegularExpression, in text: String, _ replace: (String, String) -> String) -> String {
    var out = ""
    var at = text.startIndex
    for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        guard let whole = Range(match.range, in: text), let group = Range(match.range(at: 1), in: text) else { continue }
        out += text[at..<whole.lowerBound] + replace(String(text[whole]), String(text[group]))
        at = whole.upperBound
    }
    return out + text[at...]
}

/// `$x$` into `$$x$$`, leaving `$$…$$`, `\$` and prose with prices alone.
private func pandocDollars(_ text: String) -> String {
    guard text.unicodeScalars.contains("$") else { return text }
    let s = Array(text.unicodeScalars)
    var out = String.UnicodeScalarView()
    var at = 0
    var i = 0
    while i < s.count {
        let char = s[i]
        if char == "\\" {
            i += 2
            continue
        }
        if char != "$" {
            i += 1
            continue
        }
        if i + 1 < s.count && s[i + 1] == "$" {
            guard let close = doubleDollar(in: s, from: i + 2) else { break }
            i = close + 2
            continue
        }
        guard let close = singleDollarEnd(s, from: i) else {
            i += 1
            continue
        }
        out += s[at..<i]
        out += "$$".unicodeScalars
        out += s[(i + 1)..<close]
        out += "$$".unicodeScalars
        at = close + 1
        i = close + 1
    }
    out += s[at...]
    return String(out)
}

private func doubleDollar(in s: [Unicode.Scalar], from: Int) -> Int? {
    var k = from
    while k + 1 < s.count {
        if s[k] == "$" && s[k + 1] == "$" { return k }
        k += 1
    }
    return nil
}

private func isSpace(_ c: Unicode.Scalar?) -> Bool { c?.properties.isWhitespace == true }

private func isAsciiLetterOrDigit(_ c: Unicode.Scalar) -> Bool {
    ("A"..."Z").contains(c) || ("a"..."z").contains(c) || ("0"..."9").contains(c)
}

/// Where the `$x$` opened at `from` closes, or nil when it isn't math.
private func singleDollarEnd(_ s: [Unicode.Scalar], from: Int) -> Int? {
    let before = from > 0 ? s[from - 1] : nil
    let first = from + 1 < s.count ? s[from + 1] : nil
    if first == nil || isSpace(first) || before.map(isAsciiLetterOrDigit) == true { return nil }
    var k = from + 2
    while k < s.count {
        if s[k] == "\\" {
            k += 2
            continue
        }
        if s[k] != "$" {
            k += 1
            continue
        }
        // A formula holds no other dollar, so the first one decides.
        let next = k + 1 < s.count ? s[k + 1] : nil
        if isSpace(s[k - 1]) || next == "$" || next.map({ ("0"..."9").contains($0) }) == true { return nil }
        // "$HOME/$USER", "$a-$b": a formula doesn't end on a separator or an operator.
        return "/:,;.-=+*^_([{<>&".unicodeScalars.contains(s[k - 1]) ? nil : k
    }
    return nil
}
