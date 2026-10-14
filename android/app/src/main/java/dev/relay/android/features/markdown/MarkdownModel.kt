package dev.relay.android.features.markdown

import androidx.compose.runtime.Immutable
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableHead
import org.commonmark.ext.gfm.tables.TableRow
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.ext.task.list.items.TaskListItemsExtension
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.LinkReferenceDefinition
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

// An answer as plain immutable data: Compose skips every block that didn't
// change, and a streaming answer re-parses only its last blocks.

@Immutable
sealed interface MdBlock {
    data class Para(val inlines: List<MdInline>) : MdBlock
    data class Heading(val level: Int, val inlines: List<MdInline>) : MdBlock
    data class Code(val language: String, val code: String) : MdBlock
    data class Math(val tex: String, val closed: Boolean) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data class Items(val ordered: Boolean, val start: Int, val items: List<Item>) : MdBlock
    data class Table(val header: List<List<MdInline>>, val rows: List<List<List<MdInline>>>) : MdBlock
    data class Raw(val text: String) : MdBlock
    data object Rule : MdBlock
}

/** A list item; `task` is null for an ordinary one, else whether it is ticked. */
@Immutable
data class Item(val task: Boolean?, val blocks: List<MdBlock>)

@Immutable
sealed interface MdInline {
    data class Plain(val text: String) : MdInline
    data class Strong(val children: List<MdInline>) : MdInline
    data class Em(val children: List<MdInline>) : MdInline
    data class Del(val children: List<MdInline>) : MdInline
    data class Code(val code: String) : MdInline
    data class Math(val tex: String) : MdInline
    data class Link(val href: String, val children: List<MdInline>) : MdInline
    data class Image(val src: String, val alt: String) : MdInline
}

private val parser: Parser = Parser.builder()
    .extensions(
        listOf(
            TablesExtension.create(),
            StrikethroughExtension.create(),
            TaskListItemsExtension.create(),
            AutolinkExtension.create(),
        ),
    )
    .math()
    .includeSourceSpans(IncludeSourceSpans.BLOCKS)
    .build()

/** A parsed block with the line of the (normalized) text it starts on. */
internal class Placed(val block: MdBlock, val line: Int)

/** Parses already-normalized text; `firstLine` shifts the lines it reports. */
internal fun parseBlocks(text: String, firstLine: Int = 0): List<Placed> {
    val out = ArrayList<Placed>()
    var node = parser.parse(text).firstChild
    while (node != null) {
        val block = toBlock(node)
        if (block != null) out += Placed(block, firstLine + (node.sourceSpans.firstOrNull()?.lineIndex ?: 0))
        node = node.next
    }
    return out
}

/** The blocks of an answer, all at once. */
fun parseMarkdown(markdown: String): List<MdBlock> = parseBlocks(normalizeMath(markdown)).map { it.block }

private fun Node.children(): Sequence<Node> = generateSequence(firstChild) { it.next }

private fun blocksOf(node: Node) = node.children().mapNotNull(::toBlock).toList()

private fun toBlock(node: Node): MdBlock? = when (node) {
    is Paragraph -> MdBlock.Para(inlinesOf(node))
    is Heading -> MdBlock.Heading(node.level, inlinesOf(node))
    is FencedCodeBlock -> MdBlock.Code(node.info.orEmpty().trim().substringBefore(' '), node.literal.removeSuffix("\n"))
    is IndentedCodeBlock -> MdBlock.Code("", node.literal.removeSuffix("\n"))
    is MathBlockNode -> MdBlock.Math(node.tex, node.closed)
    is BlockQuote -> MdBlock.Quote(blocksOf(node))
    is BulletList -> MdBlock.Items(false, 1, node.children().filterIsInstance<ListItem>().map(::itemOf).toList())
    is OrderedList -> MdBlock.Items(
        true,
        node.markerStartNumber ?: 1,
        node.children().filterIsInstance<ListItem>().map(::itemOf).toList(),
    )
    is ThematicBreak -> MdBlock.Rule
    is TableBlock -> tableOf(node)
    is HtmlBlock -> node.literal.trim().takeIf { it.isNotEmpty() }?.let { MdBlock.Raw(it) }
    is LinkReferenceDefinition -> null
    else -> null
}

private fun itemOf(item: ListItem): Item {
    val marker = item.firstChild as? TaskListItemMarker ?: item.firstChild?.firstChild as? TaskListItemMarker
    return Item(marker?.isChecked, blocksOf(item))
}

private fun tableOf(table: TableBlock): MdBlock.Table {
    val header = ArrayList<List<MdInline>>()
    val rows = ArrayList<List<List<MdInline>>>()
    for (section in table.children()) {
        for (row in section.children().filterIsInstance<TableRow>()) {
            val cells = row.children().filterIsInstance<TableCell>().map { inlinesOf(it) }.toList()
            if (section is TableHead) header += cells else rows += cells
        }
    }
    return MdBlock.Table(header, rows)
}

internal fun inlinesOf(node: Node): List<MdInline> {
    val out = ArrayList<MdInline>()
    for (child in node.children()) {
        val inline: MdInline? = when (child) {
            is Text -> MdInline.Plain(child.literal)
            is SoftLineBreak, is HardLineBreak -> MdInline.Plain("\n")
            is StrongEmphasis -> MdInline.Strong(inlinesOf(child))
            is Emphasis -> MdInline.Em(inlinesOf(child))
            is Strikethrough -> MdInline.Del(inlinesOf(child))
            is Code -> MdInline.Code(child.literal)
            is InlineMathNode -> MdInline.Math(child.tex)
            is Link -> MdInline.Link(child.destination, inlinesOf(child))
            is Image -> MdInline.Image(child.destination, plainText(child))
            is HtmlInline -> MdInline.Plain(child.literal)
            is TaskListItemMarker -> null
            else -> {
                inlinesOf(child).forEach { add(out, it) }
                null
            }
        }
        if (inline != null) add(out, inline)
    }
    return out
}

/** Adjacent text runs merge, so one sentence stays one span. */
private fun add(out: MutableList<MdInline>, inline: MdInline) {
    val last = out.lastOrNull()
    if (inline is MdInline.Plain && last is MdInline.Plain) out[out.size - 1] = MdInline.Plain(last.text + inline.text)
    else out += inline
}

/** The text of a node and everything in it, as an image's alt. */
private fun plainText(node: Node): String = buildString {
    for (child in node.children()) {
        when (child) {
            is Text -> append(child.literal)
            is Code -> append(child.literal)
            is SoftLineBreak, is HardLineBreak -> append(' ')
            else -> append(plainText(child))
        }
    }
}
