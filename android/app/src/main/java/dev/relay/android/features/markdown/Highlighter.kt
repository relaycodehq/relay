package dev.relay.android.features.markdown

import java.util.regex.Pattern

// A small regex tokenizer in place of Prism (mobile/src/ui/Code.tsx): the same
// languages, coloured with One Dark / One Light. It reads like Prism for the
// common cases and never fails: what no rule matches is plain text.

enum class TokenKind { Plain, Comment, Keyword, Text, Number, Function, Type, Property, Tag, Attribute, Operator, Punctuation }

data class CodeToken(val text: String, val kind: TokenKind)

/** Prism's grammar names by file extension or fence name, as Code.tsx maps them. */
private val LANGUAGES = mapOf(
    "ts" to "tsx", "tsx" to "tsx", "mts" to "tsx", "cts" to "tsx", "typescript" to "tsx",
    "js" to "jsx", "jsx" to "jsx", "mjs" to "jsx", "cjs" to "jsx", "javascript" to "jsx",
    "json" to "json", "jsonc" to "json", "md" to "markdown", "markdown" to "markdown",
    "py" to "python", "python" to "python", "rs" to "rust", "rust" to "rust", "go" to "go",
    "yml" to "yaml", "yaml" to "yaml", "swift" to "swift", "kt" to "kotlin", "kts" to "kotlin",
    "kotlin" to "kotlin", "graphql" to "graphql", "gql" to "graphql",
    "c" to "cpp", "h" to "cpp", "cpp" to "cpp", "cc" to "cpp", "hpp" to "cpp",
    "html" to "markup", "xml" to "markup", "svg" to "markup",
    "sh" to "shell", "bash" to "shell", "zsh" to "shell", "shell" to "shell", "console" to "shell",
)

/** The grammar for a path's extension (`a/b.ts`) or a fence's language (`ts`), or null. */
fun languageFor(pathOrFence: String): String? {
    val name = pathOrFence.trim().substringAfterLast('/').lowercase()
    return LANGUAGES[name] ?: LANGUAGES[name.substringAfterLast('.')]
}

private class Rule(regex: String, val kind: TokenKind, flags: Int = 0) {
    val pattern: Pattern = Pattern.compile(regex, flags)
}

private fun keywords(list: String) = "\\b(?:" + list.trim().split(Regex("\\s+")).joinToString("|") + ")\\b"

private const val BLOCK_COMMENT = "/\\*[\\s\\S]*?(?:\\*/|$)"
private const val LINE_COMMENT = "//.*"
private const val DOUBLE = "\"(?:\\\\.|[^\"\\\\\\n])*\"?"
private const val SINGLE = "'(?:\\\\.|[^'\\\\\\n])*'?"
private const val NUMBER = "\\b(?:0[xXbBoO][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?)[a-zA-Z]*\\b"
private const val FUNCTION = "\\b[A-Za-z_]\\w*(?=\\s*\\()"
private const val TYPE = "\\b[A-Z]\\w*\\b"
private const val OPERATOR = "[-+*/%=<>!&|^~?:]+"
private const val PUNCTUATION = "[{}\\[\\]();,.@#]"

private fun cLike(keywordList: String, vararg extra: Rule) = listOf(
    Rule(BLOCK_COMMENT, TokenKind.Comment),
    Rule(LINE_COMMENT, TokenKind.Comment),
    *extra,
    Rule(DOUBLE, TokenKind.Text),
    Rule(SINGLE, TokenKind.Text),
    Rule(keywords(keywordList), TokenKind.Keyword),
    Rule(NUMBER, TokenKind.Number),
    Rule(FUNCTION, TokenKind.Function),
    Rule(TYPE, TokenKind.Type),
    Rule(OPERATOR, TokenKind.Operator),
    Rule(PUNCTUATION, TokenKind.Punctuation),
)

private const val JS_KEYWORDS = """
    as async await break case catch class const continue debugger default delete do else enum export extends
    false finally for from function get if implements import in instanceof interface let new null of package
    private protected public readonly return satisfies set static super switch this throw true try type typeof
    undefined var void while with yield keyof declare namespace abstract
"""

private val GRAMMARS: Map<String, List<Rule>> = mapOf(
    "tsx" to cLike(JS_KEYWORDS, Rule("`(?:\\\\.|[^`\\\\])*`?", TokenKind.Text), Rule("</?[A-Za-z][\\w.]*", TokenKind.Tag)),
    "jsx" to cLike(JS_KEYWORDS, Rule("`(?:\\\\.|[^`\\\\])*`?", TokenKind.Text), Rule("</?[A-Za-z][\\w.]*", TokenKind.Tag)),
    "kotlin" to cLike(
        """as break class continue do else false for fun if in interface is null object package return super this
        throw true try typealias val var when while by catch constructor data enum finally get import init inline
        internal lateinit open operator out override private protected public reified sealed set suspend tailrec
        vararg companion const annotation crossinline noinline value""",
        Rule("\"\"\"[\\s\\S]*?(?:\"\"\"|$)", TokenKind.Text),
        Rule("@\\w+", TokenKind.Attribute),
    ),
    "swift" to cLike(
        """associatedtype class deinit enum extension func import init inout internal let operator private protocol
        public static struct subscript typealias var break case continue default defer do else fallthrough for guard
        if in repeat return switch where while as catch false is nil rethrows super self Self throw throws true try
        async await some any final override mutating lazy weak open private fileprivate""",
        Rule("\"\"\"[\\s\\S]*?(?:\"\"\"|$)", TokenKind.Text),
        Rule("@\\w+", TokenKind.Attribute),
    ),
    "go" to cLike(
        """break case chan const continue default defer else fallthrough for func go goto if import interface map
        package range return select struct switch type var true false nil iota""",
        Rule("`[^`]*`?", TokenKind.Text),
    ),
    "rust" to cLike(
        """as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod
        move mut pub ref return self Self static struct super trait true type unsafe use where while""",
        Rule("#!?\\[[^\\]]*]", TokenKind.Attribute),
        Rule("\\b\\w+!", TokenKind.Function),
    ),
    "cpp" to cLike(
        """auto break case char const continue default do double else enum extern float for goto if inline int long
        register return short signed sizeof static struct switch typedef union unsigned void volatile while class
        namespace template typename public private protected virtual override new delete this nullptr true false
        using bool const_cast static_cast dynamic_cast reinterpret_cast constexpr noexcept""",
        Rule("#\\s*\\w+", TokenKind.Keyword),
    ),
    "graphql" to listOf(
        Rule("#.*", TokenKind.Comment),
        Rule(DOUBLE, TokenKind.Text),
        Rule(keywords("query mutation subscription fragment on type input enum interface union scalar schema extend implements directive true false null"), TokenKind.Keyword),
        Rule("\\$\\w+", TokenKind.Property),
        Rule("@\\w+", TokenKind.Attribute),
        Rule(TYPE, TokenKind.Type),
        Rule(NUMBER, TokenKind.Number),
        Rule("[{}\\[\\]():!=|]", TokenKind.Punctuation),
    ),
    "python" to listOf(
        Rule("#.*", TokenKind.Comment),
        Rule("(?:[rRbBuUfF]{0,2})(?:\"\"\"[\\s\\S]*?(?:\"\"\"|$)|'''[\\s\\S]*?(?:'''|$))", TokenKind.Text),
        Rule("(?:[rRbBuUfF]{0,2})(?:$DOUBLE|$SINGLE)", TokenKind.Text),
        Rule("@[\\w.]+", TokenKind.Attribute),
        Rule(
            keywords(
                """and as assert async await break class continue def del elif else except finally for from global if
                import in is lambda nonlocal not or pass raise return try while with yield None True False self match case""",
            ),
            TokenKind.Keyword,
        ),
        Rule(NUMBER, TokenKind.Number),
        Rule(FUNCTION, TokenKind.Function),
        Rule(TYPE, TokenKind.Type),
        Rule(OPERATOR, TokenKind.Operator),
        Rule(PUNCTUATION, TokenKind.Punctuation),
    ),
    "json" to listOf(
        Rule(LINE_COMMENT, TokenKind.Comment),
        Rule("$DOUBLE(?=\\s*:)", TokenKind.Property),
        Rule(DOUBLE, TokenKind.Text),
        Rule("-?$NUMBER", TokenKind.Number),
        Rule(keywords("true false null"), TokenKind.Keyword),
        Rule("[{}\\[\\],:]", TokenKind.Punctuation),
    ),
    "yaml" to listOf(
        Rule("#.*", TokenKind.Comment),
        Rule("(?m)^[ \\t]*-?[ \\t]*[\\w.\"'/-]+(?=[ \\t]*:(?:\\s|$))", TokenKind.Property),
        Rule(DOUBLE, TokenKind.Text),
        Rule(SINGLE, TokenKind.Text),
        Rule("[&*][\\w-]+", TokenKind.Attribute),
        Rule(keywords("true false null yes no on off"), TokenKind.Keyword),
        Rule(NUMBER, TokenKind.Number),
        Rule("[:\\-|>{}\\[\\],]", TokenKind.Punctuation),
    ),
    "markdown" to listOf(
        Rule("(?m)^#{1,6}[ \\t].*", TokenKind.Keyword),
        Rule("```[\\s\\S]*?(?:```|$)", TokenKind.Text),
        Rule("`[^`\\n]+`", TokenKind.Text),
        Rule("\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__", TokenKind.Type),
        Rule("\\[[^\\]\\n]*]\\([^)\\n]*\\)", TokenKind.Function),
        Rule("(?m)^[ \\t]*(?:[-*+]|\\d+\\.)(?=[ \\t])", TokenKind.Punctuation),
        Rule("(?m)^>.*", TokenKind.Comment),
    ),
    "markup" to listOf(
        Rule("<!--[\\s\\S]*?(?:-->|$)", TokenKind.Comment),
        Rule("<![^>]*>?", TokenKind.Comment),
        Rule("</?[A-Za-z][\\w:.-]*", TokenKind.Tag),
        Rule("/?>", TokenKind.Tag),
        Rule("(?<=\\s)[A-Za-z_:][\\w:.-]*(?==)", TokenKind.Attribute),
        Rule("=(?=[\"'])", TokenKind.Punctuation),
        Rule(DOUBLE, TokenKind.Text),
        Rule(SINGLE, TokenKind.Text),
        Rule("&#?\\w+;", TokenKind.Keyword),
    ),
    "shell" to listOf(
        Rule("(?<![\\w$])#.*", TokenKind.Comment),
        Rule(DOUBLE, TokenKind.Text),
        Rule("'[^']*'?", TokenKind.Text),
        Rule("\\$\\{[^}\\n]*}?|\\$[\\w@#?$!*-]", TokenKind.Property),
        Rule(keywords("if then else elif fi for in do done while until case esac function return local export"), TokenKind.Keyword),
        Rule("(?m)(?<=^|[|;&]\\s{0,8})[A-Za-z_][\\w.-]*", TokenKind.Function),
        Rule("(?<=\\s)--?[\\w-]+", TokenKind.Attribute),
        Rule("[|&;<>()]+", TokenKind.Operator),
    ),
)

private val IDENTIFIER = Pattern.compile("[A-Za-z_$][\\w$]*|\\s+|.", Pattern.DOTALL)

/** `code` cut into coloured tokens, then into lines; plain text when the language is unknown. */
fun highlight(code: String, language: String?): List<List<CodeToken>> {
    val grammar = language?.let(GRAMMARS::get)
    val tokens = if (grammar == null) listOf(CodeToken(code, TokenKind.Plain)) else tokenize(code, grammar)
    return splitLines(tokens)
}

private fun tokenize(code: String, rules: List<Rule>): List<CodeToken> {
    val out = ArrayList<CodeToken>()
    val plain = StringBuilder()
    val matchers = rules.map { it.pattern.matcher(code) }
    var at = 0
    while (at < code.length) {
        var hit: CodeToken? = null
        for (i in rules.indices) {
            val m = matchers[i]
            m.region(at, code.length)
            m.useTransparentBounds(true)
            m.useAnchoringBounds(false)
            if (m.lookingAt() && m.end() > at) {
                hit = CodeToken(code.substring(at, m.end()), rules[i].kind)
                break
            }
        }
        if (hit != null) {
            if (plain.isNotEmpty()) out += CodeToken(plain.toString(), TokenKind.Plain).also { plain.clear() }
            out += hit
            at += hit.text.length
        } else {
            // A whole word at once, so a keyword's tail never matches inside an identifier.
            val m = IDENTIFIER.matcher(code).region(at, code.length)
            m.lookingAt()
            plain.append(code, at, m.end())
            at = m.end()
        }
    }
    if (plain.isNotEmpty()) out += CodeToken(plain.toString(), TokenKind.Plain)
    return out
}

private fun splitLines(tokens: List<CodeToken>): List<List<CodeToken>> {
    val lines = ArrayList<List<CodeToken>>()
    var line = ArrayList<CodeToken>()
    for (token in tokens) {
        val parts = token.text.split('\n')
        parts.forEachIndexed { i, part ->
            if (i > 0) {
                lines += line
                line = ArrayList()
            }
            if (part.isNotEmpty()) line += CodeToken(part, token.kind)
        }
    }
    lines += line
    return lines
}
