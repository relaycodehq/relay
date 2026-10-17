import Foundation

// A small regex tokenizer in place of Prism (Android's Highlighter.kt): the same languages,
// coloured with One Dark / One Light. It reads like Prism for the common cases and never
// fails: what no rule matches is plain text.

public enum TokenKind: Sendable {
    case plain, comment, keyword, text, number, function, type, property, tag, attribute, op, punctuation
}

public struct CodeToken: Equatable, Sendable {
    public var text: String
    public var kind: TokenKind
}

/// The first lines only; a phone isn't where to read a generated bundle.
public let maxCodeLines = 5000

/// Prism's grammar names by file extension or fence name.
private let languages: [String: String] = [
    "ts": "tsx", "tsx": "tsx", "mts": "tsx", "cts": "tsx", "typescript": "tsx",
    "js": "jsx", "jsx": "jsx", "mjs": "jsx", "cjs": "jsx", "javascript": "jsx",
    "json": "json", "jsonc": "json", "md": "markdown", "markdown": "markdown",
    "py": "python", "python": "python", "rs": "rust", "rust": "rust", "go": "go",
    "yml": "yaml", "yaml": "yaml", "swift": "swift", "kt": "kotlin", "kts": "kotlin",
    "kotlin": "kotlin", "graphql": "graphql", "gql": "graphql",
    "c": "cpp", "h": "cpp", "cpp": "cpp", "cc": "cpp", "hpp": "cpp",
    "html": "markup", "xml": "markup", "svg": "markup",
    "sh": "shell", "bash": "shell", "zsh": "shell", "shell": "shell", "console": "shell",
]

/// The grammar for a path's extension (`a/b.ts`) or a fence's language (`ts`), or nil.
public func languageFor(_ pathOrFence: String) -> String? {
    let name = (pathOrFence.trimmingCharacters(in: .whitespaces).split(separator: "/").last.map(String.init) ?? "")
        .lowercased()
    return languages[name] ?? name.split(separator: ".").last.flatMap { languages[String($0)] }
}

private struct Rule: Sendable {
    let regex: NSRegularExpression
    let kind: TokenKind

    init(_ pattern: String, _ kind: TokenKind) {
        regex = try! NSRegularExpression(pattern: pattern)
        self.kind = kind
    }
}

private func keywords(_ list: String) -> String {
    "\\b(?:" + list.split(whereSeparator: \.isWhitespace).joined(separator: "|") + ")\\b"
}

private let blockComment = #"/\*[\s\S]*?(?:\*/|$)"#
private let lineComment = "//.*"
private let double = #""(?:\\.|[^"\\\n])*"?"#
private let single = #"'(?:\\.|[^'\\\n])*'?"#
private let number = #"\b(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z]*\b"#
private let function = #"\b[A-Za-z_]\w*(?=\s*\()"#
private let type = #"\b[A-Z]\w*\b"#
private let op = #"[-+*/%=<>!&|^~?:]+"#
private let punctuation = #"[{}\[\]();,.@#]"#

private func cLike(_ keywordList: String, _ extra: Rule...) -> [Rule] {
    [Rule(blockComment, .comment), Rule(lineComment, .comment)] + extra + [
        Rule(double, .text),
        Rule(single, .text),
        Rule(keywords(keywordList), .keyword),
        Rule(number, .number),
        Rule(function, .function),
        Rule(type, .type),
        Rule(op, .op),
        Rule(punctuation, .punctuation),
    ]
}

private let jsKeywords = """
    as async await break case catch class const continue debugger default delete do else enum export extends
    false finally for from function get if implements import in instanceof interface let new null of package
    private protected public readonly return satisfies set static super switch this throw true try type typeof
    undefined var void while with yield keyof declare namespace abstract
    """

private let jsExtras = [Rule(#"`(?:\\.|[^`\\])*`?"#, .text), Rule(#"</?[A-Za-z][\w.]*"#, .tag)]

private let grammars: [String: [Rule]] = [
    "tsx": cLike(jsKeywords, jsExtras[0], jsExtras[1]),
    "jsx": cLike(jsKeywords, jsExtras[0], jsExtras[1]),
    "kotlin": cLike(
        """
        as break class continue do else false for fun if in interface is null object package return super this
        throw true try typealias val var when while by catch constructor data enum finally get import init inline
        internal lateinit open operator out override private protected public reified sealed set suspend tailrec
        vararg companion const annotation crossinline noinline value
        """,
        Rule(#""""[\s\S]*?(?:"""|$)"#, .text),
        Rule(#"@\w+"#, .attribute)),
    "swift": cLike(
        """
        associatedtype class deinit enum extension func import init inout internal let operator private protocol
        public static struct subscript typealias var break case continue default defer do else fallthrough for guard
        if in repeat return switch where while as catch false is nil rethrows super self Self throw throws true try
        async await some any final override mutating lazy weak open private fileprivate
        """,
        Rule(#""""[\s\S]*?(?:"""|$)"#, .text),
        Rule(#"@\w+"#, .attribute)),
    "go": cLike(
        """
        break case chan const continue default defer else fallthrough for func go goto if import interface map
        package range return select struct switch type var true false nil iota
        """,
        Rule("`[^`]*`?", .text)),
    "rust": cLike(
        """
        as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod
        move mut pub ref return self Self static struct super trait true type unsafe use where while
        """,
        Rule(#"#!?\[[^\]]*]"#, .attribute),
        Rule(#"\b\w+!"#, .function)),
    "cpp": cLike(
        """
        auto break case char const continue default do double else enum extern float for goto if inline int long
        register return short signed sizeof static struct switch typedef union unsigned void volatile while class
        namespace template typename public private protected virtual override new delete this nullptr true false
        using bool const_cast static_cast dynamic_cast reinterpret_cast constexpr noexcept
        """,
        Rule(#"#\s*\w+"#, .keyword)),
    "graphql": [
        Rule("#.*", .comment),
        Rule(double, .text),
        Rule(
            keywords(
                "query mutation subscription fragment on type input enum interface union scalar schema extend implements directive true false null"
            ), .keyword),
        Rule(#"\$\w+"#, .property),
        Rule(#"@\w+"#, .attribute),
        Rule(type, .type),
        Rule(number, .number),
        Rule(#"[{}\[\]():!=|]"#, .punctuation),
    ],
    "python": [
        Rule("#.*", .comment),
        Rule(#"(?:[rRbBuUfF]{0,2})(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))"#, .text),
        Rule("(?:[rRbBuUfF]{0,2})(?:\(double)|\(single))", .text),
        Rule(#"@[\w.]+"#, .attribute),
        Rule(
            keywords(
                """
                and as assert async await break class continue def del elif else except finally for from global if
                import in is lambda nonlocal not or pass raise return try while with yield None True False self match case
                """), .keyword),
        Rule(number, .number),
        Rule(function, .function),
        Rule(type, .type),
        Rule(op, .op),
        Rule(punctuation, .punctuation),
    ],
    "json": [
        Rule(lineComment, .comment),
        Rule(#"\#(double)(?=\s*:)"#, .property),
        Rule(double, .text),
        Rule("-?\(number)", .number),
        Rule(keywords("true false null"), .keyword),
        Rule(#"[{}\[\],:]"#, .punctuation),
    ],
    "yaml": [
        Rule("#.*", .comment),
        Rule(#"(?m)^[ \t]*-?[ \t]*[\w."'/-]+(?=[ \t]*:(?:\s|$))"#, .property),
        Rule(double, .text),
        Rule(single, .text),
        Rule(#"[&*][\w-]+"#, .attribute),
        Rule(keywords("true false null yes no on off"), .keyword),
        Rule(number, .number),
        Rule(#"[:\-|>{}\[\],]"#, .punctuation),
    ],
    "markdown": [
        Rule(#"(?m)^#{1,6}[ \t].*"#, .keyword),
        Rule(#"```[\s\S]*?(?:```|$)"#, .text),
        Rule(#"`[^`\n]+`"#, .text),
        Rule(#"\*\*[^*\n]+\*\*|__[^_\n]+__"#, .type),
        Rule(#"\[[^\]\n]*]\([^)\n]*\)"#, .function),
        Rule(#"(?m)^[ \t]*(?:[-*+]|\d+\.)(?=[ \t])"#, .punctuation),
        Rule("(?m)^>.*", .comment),
    ],
    "markup": [
        Rule(#"<!--[\s\S]*?(?:-->|$)"#, .comment),
        Rule("<![^>]*>?", .comment),
        Rule(#"</?[A-Za-z][\w:.-]*"#, .tag),
        Rule("/?>", .tag),
        Rule(#"(?<=\s)[A-Za-z_:][\w:.-]*(?==)"#, .attribute),
        Rule(#"=(?=["'])"#, .punctuation),
        Rule(double, .text),
        Rule(single, .text),
        Rule(#"&#?\w+;"#, .keyword),
    ],
    "shell": [
        Rule(#"(?<![\w$])#.*"#, .comment),
        Rule(double, .text),
        Rule("'[^']*'?", .text),
        Rule(#"\$\{[^}\n]*\}?|\$[\w@#?$!*-]"#, .property),
        Rule(keywords("if then else elif fi for in do done while until case esac function return local export"), .keyword),
        Rule(#"(?m)(?<=^|[|;&]\s{0,8})[A-Za-z_][\w.-]*"#, .function),
        Rule(#"(?<=\s)--?[\w-]+"#, .attribute),
        Rule("[|&;<>()]+", .op),
    ],
]

private let identifier = try! NSRegularExpression(pattern: #"[A-Za-z_$][\w$]*|\s+|."#, options: [.dotMatchesLineSeparators])

/// `code` cut into coloured tokens, then into lines; plain text when the language is unknown.
public func highlight(_ code: String, language: String?) -> [[CodeToken]] {
    // Swift keeps "\r\n" as one character, which a split on "\n" wouldn't see.
    let code = code.replacingOccurrences(of: "\r\n", with: "\n")
    let tokens = language.flatMap { grammars[$0] }.map { tokenize(code, $0) } ?? [CodeToken(text: code, kind: .plain)]
    return splitLines(tokens)
}

/// The first `maxCodeLines` of `code`.
public func firstLines(_ code: String, _ count: Int = maxCodeLines) -> String {
    var seen = 0
    for i in code.unicodeScalars.indices where code.unicodeScalars[i] == "\n" {
        seen += 1
        if seen == count { return String(code.unicodeScalars[..<i]) }
    }
    return code
}

private func tokenize(_ code: String, _ rules: [Rule]) -> [CodeToken] {
    let ns = code as NSString
    let length = ns.length
    // As Java's lookingAt over a region: lookarounds see past its start, ^ and $ don't stop at it.
    let options: NSRegularExpression.MatchingOptions = [.anchored, .withTransparentBounds, .withoutAnchoringBounds]
    var out: [CodeToken] = []
    var plainStart = -1
    var at = 0
    func flushPlain() {
        if plainStart >= 0 {
            out.append(CodeToken(text: ns.substring(with: NSRange(location: plainStart, length: at - plainStart)), kind: .plain))
            plainStart = -1
        }
    }
    while at < length {
        let rest = NSRange(location: at, length: length - at)
        var hit: (end: Int, kind: TokenKind)?
        for rule in rules {
            if let m = rule.regex.firstMatch(in: code, options: options, range: rest), m.range.length > 0 {
                hit = (m.range.location + m.range.length, rule.kind)
                break
            }
        }
        if let hit {
            flushPlain()
            out.append(CodeToken(text: ns.substring(with: NSRange(location: at, length: hit.end - at)), kind: hit.kind))
            at = hit.end
        } else {
            // A whole word at once, so a keyword's tail never matches inside an identifier.
            if plainStart < 0 { plainStart = at }
            let m = identifier.firstMatch(in: code, options: options, range: rest)
            at += max(1, m?.range.length ?? 1)
        }
    }
    flushPlain()
    return out
}

private func splitLines(_ tokens: [CodeToken]) -> [[CodeToken]] {
    var lines: [[CodeToken]] = []
    var line: [CodeToken] = []
    for token in tokens {
        for (i, part) in token.text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            if i > 0 {
                lines.append(line)
                line = []
            }
            if !part.isEmpty { line.append(CodeToken(text: String(part), kind: token.kind)) }
        }
    }
    lines.append(line)
    return lines
}
