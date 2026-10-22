package dev.relay.android.features.markdown

/**
 * Parses an answer as it streams in without starting over each time: the
 * blocks before the last one that starts after a blank line can't change when
 * text is added, so they are kept (the same instances, which Compose skips)
 * and only the text from there on is parsed again.
 */
class MarkdownCache {
    private var text = ""
    private var placed: List<Placed> = emptyList()
    private var blocks: List<MarkdownBlock> = emptyList()

    fun blocks(markdown: String): List<MdBlock> = positioned(markdown).map { it.block }

    fun positioned(markdown: String): List<MarkdownBlock> {
        val next = normalizeMath(markdown)
        if (next == text && placed.isNotEmpty()) return blocks
        val (keep, offset, line) = reusable(next)
        placed = placed.subList(0, keep) + parseBlocks(next.substring(offset), line)
        // Kept blocks stay the same instances, so the list's items compare equal and skip.
        blocks = placed.map { MarkdownBlock(it.line, it.block) }
        text = next
        return blocks
    }

    /** How many blocks to keep, and the offset and line the rest starts at. */
    private fun reusable(next: String): Triple<Int, Int, Int> {
        // References have document-wide scope: a definition arriving at the end
        // can turn an earlier plain label into a link. Keep its key, reparse its content.
        if (placed.size < 2 || referenceDefinition.containsMatchIn(next) || referenceDefinition.containsMatchIn(text)) return Triple(0, 0, 0)
        val starts = lineStarts(text)
        for (k in placed.size - 1 downTo 1) {
            val line = placed[k].line
            if (line <= 0 || line >= starts.size) continue
            val previous = text.substring(starts[line - 1], starts[line]).trim()
            if (previous.isNotEmpty()) continue
            val offset = starts[line]
            if (next.length >= offset && next.regionMatches(0, text, 0, offset)) return Triple(k, offset, line)
        }
        return Triple(0, 0, 0)
    }

    private val referenceDefinition = Regex("""(?m)^ {0,3}\[[^\]\n]+\]:""")

    private fun lineStarts(text: String): IntArray {
        val starts = ArrayList<Int>()
        starts += 0
        text.forEachIndexed { i, c -> if (c == '\n') starts += i + 1 }
        return starts.toIntArray()
    }
}

/** Source positions survive appends and block-kind changes, unlike content hashes. */
@androidx.compose.runtime.Immutable
data class MarkdownBlock(val sourceLine: Int, val block: MdBlock)
