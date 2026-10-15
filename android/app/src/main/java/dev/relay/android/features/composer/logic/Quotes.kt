package dev.relay.android.features.composer.logic

// shared/composer-quotes.ts: a quoted passage travels as a Markdown blockquote.

/** Serialises a quote: every line prefixed, then a blank line. */
fun quoteMarkdown(text: String) = text.split("\n").joinToString("\n") { "> $it" } + "\n\n"

/** The passage inside a blockquote block, inverse of [quoteMarkdown]. */
fun unquote(block: String) =
    block.replace(Regex("\n+$"), "").split("\n").joinToString("\n") { it.replace(Regex("^> ?"), "") }

/** Trailing spaces and runs of blank lines go, indentation stays. */
fun selectionQuote(raw: String) =
    raw.replace(Regex("\r\n?"), "\n")
        .replace(' ', ' ')
        .split("\n").joinToString("\n") { it.replace(Regex("\\s+$"), "") }
        .replace(Regex("\n{3,}"), "\n\n")
        .replace(Regex("^\n+|\n+$"), "")

/** One-line preview for a pill or tooltip. */
fun quoteLabel(text: String, max: Int): String {
    val flat = text.replace(Regex("\\s+"), " ").trim()
    return if (flat.length > max) flat.substring(0, max - 1).trimEnd() + "…" else flat
}

private val fenceLine = Regex("^((?: {0,3}> ?)* {0,3})(`{3,}|~{3,})(.*)$")

/**
 * The start of a message to quote from a phone: its first `lines` lines and at
 * most `chars` characters, ending in " …" where it was cut.
 */
fun quoteExcerpt(text: String, lines: Int = 8, chars: Int = 600): String {
    val whole = text.replace(Regex("\r\n?"), "\n").replace(Regex("^\n+|\\s+$"), "")
    var cut = whole.split("\n").take(lines).joinToString("\n")
    if (cut.length > chars) cut = cut.substring(0, chars).replace(Regex("\\s+\\S*$"), "")
    // Avoid half a surrogate pair when a long unbroken line meets the limit.
    if (cut.isNotEmpty() && Character.isHighSurrogate(cut.last())) cut = cut.dropLast(1)
    cut = cut.trimEnd()
    val truncated = cut.length < whole.length
    // Close a fenced code block before the truncation mark, including nested quotes.
    var marker: String? = null
    var prefix = ""
    for (line in cut.split("\n")) {
        val m = fenceLine.find(line) ?: continue
        val (pre, mark, rest) = m.destructured
        val open = marker
        if (open == null) {
            marker = mark
            prefix = pre
        } else if (mark[0] == open[0] && mark.length >= open.length && rest.isBlank()) {
            marker = null
        }
    }
    marker?.let { return "$cut\n$prefix$it" + if (truncated) "\n\n…" else "" }
    return if (truncated) "$cut …" else cut
}

data class Appended(val text: String, val end: Int)

/** Adds a quote after a phone draft; the returned end is where replying starts. */
fun appendQuote(draft: String, markdown: String): Appended {
    val text = if (draft.isNotBlank()) "${draft.trimEnd()}\n\n$markdown" else markdown
    return Appended(text, text.length)
}
