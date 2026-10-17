import Foundation
import Markdown

// swift-markdown has no math and no way to add syntax, so math is set aside
// before parsing and picked up after, to the rules Android's MathSyntax.kt
// gives commonmark. normalizeMath leaves a display formula between `$$` lines
// and an inline one as `$$x$$`. Each `$$` line becomes a fence of tildes, so a
// formula parses as a code block wherever one can start (in a quote or a list
// item, cutting a paragraph short) and runs to the end of its container while
// its closing line hasn't arrived, as Android's math block does. Each inline
// formula becomes a placeholder the parser takes for plain text; where one
// lands outside text (code, HTML, a link's address) its source goes back.

/// What a `$$` line becomes: tildes, so no TeX line of backticks ends the formula,
/// and far more than the three a fence needs, so no fence in the text is taken for one.
let mathFence = String(repeating: "~", count: 16)

private let placeholderOpen: Unicode.Scalar = "\u{E000}"
private let placeholderClose: Unicode.Scalar = "\u{E001}"

/// Normalized text ready for the parser, with what was set aside to tell its math apart afterwards.
struct MathText {
    /// The text with each `$$` line a fence and each inline formula a placeholder.
    private(set) var text: String
    /// The lines, counted from 1 as the parser does, that were `$$` lines.
    private(set) var fenceLines: Set<Int> = []
    /// Each inline formula's source between its `$$`s, by placeholder number.
    private(set) var formulas: [String] = []

    init(_ normalized: String) {
        text = normalized
        guard normalized.unicodeScalars.contains("$") else { return }
        var lines = normalized.components(separatedBy: "\n")
        var fence: Fence?
        for i in lines.indices {
            if let open = fence {
                if open.closes(lines[i]) { fence = nil }
                continue
            }
            if let open = Fence(opening: lines[i]) {
                fence = open
                continue
            }
            if let dollars = displayFence(lines[i]) {
                lines[i].replaceSubrange(dollars, with: mathFence)
                fenceLines.insert(i + 1)
                continue
            }
            lines[i] = setAside(lines[i])
        }
        text = lines.joined(separator: "\n")
    }

    /// The display formula `block` is, with whether its closing line has arrived.
    func display(_ block: CodeBlock) -> (tex: String, closed: Bool)? {
        guard let range = block.range, fenceLines.contains(range.lowerBound.line) else { return nil }
        let first = range.lowerBound.line, last = range.upperBound.line
        let code = block.code.hasSuffix("\n") ? String(block.code.dropLast()) : block.code
        let lines = code.isEmpty ? [] : code.components(separatedBy: "\n")
        // Starting with its own fence line, it is indented code, which a `$$` line can be part of.
        if lines.first.map({ $0.trimmingCharacters(in: .whitespaces) == mathFence }) == true { return nil }
        // The parser ends an unclosed block on whatever line closed its container.
        let closed = last != first && fenceLines.contains(last) && lines.count == last - first - 1
        return (restoring(code), closed)
    }

    /// `literal` as it was written: placeholders back to their formulas' `$$…$$`, fences back to `$$`.
    func restoring(_ literal: String) -> String {
        var out = literal
        if out.contains(mathFence) {
            out = out.components(separatedBy: "\n").map { line in
                line.trimmingCharacters(in: .whitespacesAndNewlines) == mathFence
                    ? line.replacingOccurrences(of: mathFence, with: "$$") : line
            }.joined(separator: "\n")
        }
        return pieces(out).map {
            switch $0 {
            case .text(let text): text
            case .formula(let source): "$$" + source + "$$"
            }
        }.joined()
    }

    enum Piece {
        case text(String)
        /// An inline formula's source between its `$$`s, untrimmed.
        case formula(String)
    }

    /// A text node's text, split at the inline formulas set aside in it.
    func pieces(_ text: String) -> [Piece] {
        guard text.unicodeScalars.contains(placeholderOpen) else { return [.text(text)] }
        let s = Array(text.unicodeScalars)
        var out: [Piece] = []
        var at = 0
        var i = 0
        while i < s.count {
            guard s[i] == "$", let (number, end) = placeholder(s, at: i), number < formulas.count else {
                i += 1
                continue
            }
            if at < i { out.append(.text(String(String.UnicodeScalarView(s[at..<i])))) }
            out.append(.formula(formulas[number]))
            at = end
            i = end
        }
        if at < s.count { out.append(.text(String(String.UnicodeScalarView(s[at...])))) }
        return out
    }

    private func placeholder(_ s: [Unicode.Scalar], at i: Int) -> (Int, Int)? {
        guard i + 1 < s.count, s[i + 1] == placeholderOpen else { return nil }
        var k = i + 2
        var number = 0
        while k < s.count, ("0"..."9").contains(s[k]) {
            number = number * 10 + Int(s[k].value - 48)
            k += 1
        }
        guard k > i + 2, k + 1 < s.count, s[k] == placeholderClose, s[k + 1] == "$" else { return nil }
        return (number, k + 2)
    }

    /// The line with each `$$x$$` the parser would take for a formula set aside.
    private mutating func setAside(_ line: String) -> String {
        guard line.unicodeScalars.contains("$") else { return line }
        let s = Array(line.unicodeScalars)
        var out = String.UnicodeScalarView()
        var at = 0
        var i = 0
        while i < s.count {
            switch s[i] {
            case "\\":
                i += i + 1 < s.count && isAsciiPunctuation(s[i + 1]) ? 2 : 1
            case "`":
                let run = runLength(s, from: i)
                i = codeSpanEnd(s, from: i + run, run: run) ?? i + run
            case "<":
                i += autolinkLength(s, from: i) ?? 1
            case "$" where i + 1 < s.count && s[i + 1] == "$":
                guard let close = inlineEnd(s, from: i + 2) else {
                    i += 1
                    continue
                }
                out += s[at..<i]
                out += "$\(placeholderOpen)\(formulas.count)\(placeholderClose)$".unicodeScalars
                formulas.append(String(String.UnicodeScalarView(s[(i + 2)..<close])))
                at = close + 2
                i = at
            default:
                i += 1
            }
        }
        out += s[at...]
        return String(out)
    }
}

private let displayFencePattern = try! NSRegularExpression(
    pattern: #"^(?:[ \t>]|[-+*][ \t]|[0-9]{1,9}[.)][ \t])*(\$\$)[ \t\r]*$"#)

/// The `$$` of a line holding nothing else but quote marks, list markers and indent.
private func displayFence(_ line: String) -> Range<String.Index>? {
    guard line.contains("$$"),
        let match = displayFencePattern.firstMatch(in: line, range: NSRange(line.startIndex..., in: line))
    else { return nil }
    return Range(match.range(at: 1), in: line)
}

/// What a backslash escapes in CommonMark.
private func isAsciiPunctuation(_ c: Unicode.Scalar) -> Bool {
    ##"!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~"##.unicodeScalars.contains(c)
}

private func runLength(_ s: [Unicode.Scalar], from: Int) -> Int {
    var k = from
    while k < s.count && s[k] == s[from] { k += 1 }
    return k - from
}

/// Past the backticks closing a code span opened by `run` of them, or nil when none does.
private func codeSpanEnd(_ s: [Unicode.Scalar], from: Int, run: Int) -> Int? {
    var k = from
    while k < s.count {
        guard s[k] == "`" else {
            k += 1
            continue
        }
        let length = runLength(s, from: k)
        if length == run { return k + length }
        k += length
    }
    return nil
}

/// The length of a `<scheme:…>` link at `from`, which the parser takes whole.
private func autolinkLength(_ s: [Unicode.Scalar], from: Int) -> Int? {
    func letter(_ c: Unicode.Scalar) -> Bool { ("A"..."Z").contains(c) || ("a"..."z").contains(c) }
    var k = from + 1
    guard k < s.count, letter(s[k]) else { return nil }
    while k < s.count, letter(s[k]) || ("0"..."9").contains(s[k]) || "+.-".unicodeScalars.contains(s[k]) { k += 1 }
    guard (2...32).contains(k - from - 1), k < s.count, s[k] == ":" else { return nil }
    while k < s.count, s[k] != ">" {
        if s[k] == "<" || s[k].value <= 0x20 { return nil }
        k += 1
    }
    return k < s.count ? k + 1 - from : nil
}

/// Where the `$$` closing a formula whose source starts at `from` is, as Android's
/// inline parser finds it: the first `$$` after at least one character.
private func inlineEnd(_ s: [Unicode.Scalar], from: Int) -> Int? {
    var k = from + 1
    while k + 1 < s.count {
        if s[k] == "$" && s[k + 1] == "$" { return k }
        k += 1
    }
    return nil
}
