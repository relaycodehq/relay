package dev.relay.android.features.markdown

import org.commonmark.node.Block
import org.commonmark.node.CustomBlock
import org.commonmark.node.CustomNode
import org.commonmark.parser.Parser
import org.commonmark.parser.SourceLine
import org.commonmark.parser.beta.InlineContentParser
import org.commonmark.parser.beta.InlineContentParserFactory
import org.commonmark.parser.beta.InlineParserState
import org.commonmark.parser.beta.ParsedInline
import org.commonmark.parser.block.AbstractBlockParser
import org.commonmark.parser.block.AbstractBlockParserFactory
import org.commonmark.parser.block.BlockContinue
import org.commonmark.parser.block.BlockStart
import org.commonmark.parser.block.MatchedBlockParser
import org.commonmark.parser.block.ParserState

// commonmark has no math. Text goes through normalizeMath first, which leaves
// display formulas as `$$` lines and inline ones as `$$x$$`; these turn those
// into nodes, as mobile/src/ui/math/marked-math.ts does for marked.

class MathBlockNode : CustomBlock() {
    var tex: String = ""

    /** False while the formula's closing `$$` hasn't arrived. */
    var closed: Boolean = false
}

class InlineMathNode(val tex: String) : CustomNode()

private val FENCE = Regex("^\\$\\$[ \\t]*$")

private fun ParserState.fenceHere(): Boolean {
    if (indent >= 4) return false
    val content = line.content
    return FENCE.matches(content.subSequence(nextNonSpaceIndex, content.length))
}

private class MathBlockParser : AbstractBlockParser() {
    private val block = MathBlockNode()
    private val lines = ArrayList<String>()
    private var opened = false

    override fun getBlock(): Block = block

    override fun tryContinue(state: ParserState): BlockContinue {
        if (state.fenceHere()) {
            block.closed = true
            return BlockContinue.finished()
        }
        return BlockContinue.atIndex(state.index)
    }

    // The first line handed over is the rest of the opening `$$` line.
    override fun addLine(line: SourceLine) {
        if (!opened) opened = true else lines += line.content.toString()
    }

    override fun closeBlock() {
        block.tex = lines.joinToString("\n")
    }
}

private class MathBlockFactory : AbstractBlockParserFactory() {
    override fun tryStart(state: ParserState, matched: MatchedBlockParser): BlockStart? {
        if (!state.fenceHere()) return BlockStart.none()
        return BlockStart.of(MathBlockParser()).atIndex(state.line.content.length)
    }
}

private class InlineMathParser : InlineContentParser {
    override fun tryParse(state: InlineParserState): ParsedInline? {
        val scanner = state.scanner()
        if (!scanner.next("$$")) return ParsedInline.none()
        val tex = StringBuilder()
        while (scanner.hasNext()) {
            val c = scanner.peek()
            if (c == '\n') return ParsedInline.none()
            if (c == '$' && tex.isNotEmpty()) {
                val before = scanner.position()
                scanner.next()
                if (scanner.peek() == '$') {
                    scanner.next()
                    return ParsedInline.of(InlineMathNode(tex.toString().trim()), scanner.position())
                }
                scanner.setPosition(before)
            }
            tex.append(c)
            scanner.next()
        }
        return ParsedInline.none()
    }
}

private class InlineMathFactory : InlineContentParserFactory {
    override fun getTriggerCharacters(): Set<Char> = setOf('$')
    override fun create(): InlineContentParser = InlineMathParser()
}

internal fun Parser.Builder.math(): Parser.Builder =
    customBlockParserFactory(MathBlockFactory()).customInlineContentParserFactory(InlineMathFactory())
