package dev.relay.android.features.markdown

/**
 * Port of shared/math-delimiters.ts. Agents write math as `$$…$$`, `\[…\]`,
 * `\(…\)` and `$…$`; this rewrites them all into the one the parser knows: a
 * display formula becomes a `$$` line, its lines, a `$$` line; an inline one
 * becomes `$$x$$`. `$x$` follows Pandoc's rule (no space inside, no digit
 * after the closer), so prices stay prose. Code is left alone; idempotent.
 */
fun normalizeMath(text: String): String {
    if (!ANY_MATH.containsMatchIn(text)) return text
    val lines = text.split("\n")
    val out = ArrayList<String>(lines.size)
    var fence: Regex? = null
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        if (fence != null) {
            out += line
            if (fence.containsMatchIn(line)) fence = null
            i++
            continue
        }
        val open = FENCE_OPEN.find(line)?.groupValues?.get(1)
        if (open != null) {
            fence = Regex("^[ \\t>]*${Regex.escape(open[0].toString())}{${open.length},}[ \\t]*$")
            out += line
            i++
            continue
        }
        val display = displayMath(lines, i)
        if (display != null) {
            out += display.first
            i = display.second + 1
            continue
        }
        out += inlineMath(line)
        i++
    }
    return out.joinToString("\n")
}

private val ANY_MATH = Regex("""\\[(\[]|\$""")
private val FENCE_OPEN = Regex("^[ \\t>]*(`{3,}|~{3,})")
private val DISPLAY_OPENER = Regex("""^([ \t>]*)(\$\$|\\\[)(.*)$""")

/** A formula taking whole lines from `lines[from]`, rewritten, with its last line's index. */
private fun displayMath(lines: List<String>, from: Int): Pair<List<String>, Int>? {
    val match = DISPLAY_OPENER.find(lines[from]) ?: return null
    val (prefix, opener, rest) = match.destructured
    val closer = if (opener == "$$") "$$" else "\\]"
    val fence = "$prefix$$"

    val end = rest.indexOf(closer)
    if (end >= 0) {
        // Text after the closer makes it part of a sentence.
        if (rest.substring(end + closer.length).isNotBlank()) return null
        val body = rest.substring(0, end).trim()
        return (if (body.isNotEmpty()) listOf(fence, prefix + body, fence) else listOf(fence, fence)) to from
    }

    var last = from + 1
    while (last < lines.size && !stripPrefix(lines[last]).trimEnd().endsWith(closer)) last++
    val closes = last < lines.size
    if (!closes && opener != "$$" && rest.isNotBlank()) return null
    // Still streaming in: the formula runs to the end of what has arrived.
    if (!closes && rest.isNotBlank()) return listOf("$prefix\\$$$rest") to from

    val out = mutableListOf(fence)
    if (rest.isNotBlank()) out += prefix + rest.trim()
    if (!closes) return (out + lines.subList(from + 1, lines.size)) to lines.size - 1
    out += lines.subList(from + 1, last)
    val tail = stripPrefix(lines[last]).trimEnd()
    val body = tail.substring(0, tail.length - closer.length).trim()
    if (body.isNotEmpty()) out += prefix + body
    out += fence
    return out to last
}

private fun stripPrefix(line: String) = line.replace(Regex("^[ \\t>]*"), "")

private val CODE_SPAN = Regex("(`+)(?:[^`]|[^`].*?[^`])\\1(?!`)")

private fun inlineMath(line: String): String {
    if (!ANY_MATH.containsMatchIn(line)) return line
    val out = StringBuilder()
    var at = 0
    for (span in CODE_SPAN.findAll(line)) {
        out.append(convertInline(line.substring(at, span.range.first))).append(span.value)
        at = span.range.last + 1
    }
    return out.append(convertInline(line.substring(at))).toString()
}

private val PROSE_ESCAPES = Regex("""\\[dDwWsSbBntr](?![A-Za-z])|\\[.*+?()|/\[\]-]""")
private val COUNTS = Regex("""\{\d+(?:,\d*)?\}""")
private val FORMULA_CHARS = Regex("""[\\^_={}]""")

/** `\[x\]` is also how prose escapes brackets, so it needs a formula's look. */
private fun formulaLook(tex: String) =
    FORMULA_CHARS.containsMatchIn(tex.replace(PROSE_ESCAPES, "").replace(COUNTS, ""))

private val PARENS = Regex("""\\\(\s*(.+?)\s*\\\)""")
private val BRACKETS = Regex("""\\\[\s*(.+?)\s*\\]""")

private fun convertInline(text: String): String {
    val parens = text
        .replace(PARENS) { "$$" + it.groupValues[1] + "$$" }
        .replace(BRACKETS) { if (formulaLook(it.groupValues[1])) "$$" + it.groupValues[1] + "$$" else it.value }
    return pandocDollars(parens)
}

/** `$x$` into `$$x$$`, leaving `$$…$$`, `\$` and prose with prices alone. */
private fun pandocDollars(text: String): String {
    if ('$' !in text) return text
    val out = StringBuilder()
    var at = 0
    var i = 0
    while (i < text.length) {
        val char = text[i]
        if (char == '\\') {
            i += 2
            continue
        }
        if (char != '$') {
            i++
            continue
        }
        if (text.getOrNull(i + 1) == '$') {
            val close = text.indexOf("$$", i + 2)
            if (close < 0) break
            i = close + 2
            continue
        }
        val close = singleDollarEnd(text, i)
        if (close < 0) {
            i++
            continue
        }
        out.append(text, at, i).append("$$").append(text, i + 1, close).append("$$")
        at = close + 1
        i = close + 1
    }
    return out.append(text.substring(at)).toString()
}

private fun Char?.isSpace() = this != null && isWhitespace()

/** Where the `$x$` opened at `from` closes, or -1 when it isn't math. */
private fun singleDollarEnd(text: String, from: Int): Int {
    val before = text.getOrNull(from - 1)
    val first = text.getOrNull(from + 1)
    if (first == null || first.isSpace() || (before != null && before.isAsciiLetterOrDigit())) return -1
    var k = from + 2
    while (k < text.length) {
        if (text[k] == '\\') {
            k += 2
            continue
        }
        if (text[k] != '$') {
            k++
            continue
        }
        // A formula holds no other dollar, so the first one decides.
        val next = text.getOrNull(k + 1)
        if (text[k - 1].isSpace() || next == '$' || (next != null && next in '0'..'9')) return -1
        // "$HOME/$USER", "$a-$b": a formula doesn't end on a separator or an operator.
        return if (text[k - 1] in "/:,;.-=+*^_([{<>&") -1 else k
    }
    return -1
}

private fun Char.isAsciiLetterOrDigit() = this in 'A'..'Z' || this in 'a'..'z' || this in '0'..'9'
