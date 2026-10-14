package dev.relay.android.features.thread.logic

// shared/composer-quotes.ts: a quoted passage travels in the draft as a Markdown blockquote.

/** Serialises a quote: every line prefixed, then a blank line. */
fun quoteMarkdown(text: String) = text.split("\n").joinToString("\n") { "> $it" } + "\n\n"

private val FENCE = Regex("^((?: {0,3}> ?)* {0,3})(`{3,}|~{3,})(.*)$")

/**
 * The start of a message to quote from a phone: its first [lines] lines and
 * at most [chars] characters, ending in " …" where it was cut.
 */
fun quoteExcerpt(text: String, lines: Int = 8, chars: Int = 600): String {
    val whole = text.replace(Regex("\\r\\n?"), "\n").replace(Regex("^\\n+|\\s+$"), "")
    var cut = whole.split("\n").take(lines).joinToString("\n")
    if (cut.length > chars) cut = cut.take(chars).replace(Regex("\\s+\\S*$"), "")
    // Avoid half a surrogate pair when a long unbroken line meets the limit.
    if (cut.isNotEmpty() && cut.last().isHighSurrogate()) cut = cut.dropLast(1)
    cut = cut.trimEnd()
    val truncated = cut.length < whole.length
    // Close a fenced code block before the truncation mark, including nested quotes.
    var fence: Pair<String, String>? = null
    for (line in cut.split("\n")) {
        val match = FENCE.find(line) ?: continue
        val (prefix, marker, rest) = match.destructured
        val open = fence
        if (open == null) fence = marker to prefix
        else if (marker[0] == open.first[0] && marker.length >= open.first.length && rest.isBlank()) fence = null
    }
    fence?.let { (marker, prefix) -> return "$cut\n$prefix$marker${if (truncated) "\n\n…" else ""}" }
    return if (truncated) "$cut …" else cut
}
