package dev.relay.android.features.markdown

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.remote.model.TurnFileChange
import dev.relay.android.ui.Divider
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import androidx.compose.material3.Text as RichText

/**
 * What pressing a link's destination or a piece of inline code does, when it
 * names something the app can open; null leaves it as text.
 */
typealias OpenLink = (value: String, inline: Boolean) -> (() -> Unit)?

/** Draws an `![alt](src)` the app can show (a local image); drawing nothing is fine. */
typealias ShowImage = @Composable (src: String, alt: String) -> Unit

/** Paths in the thread's [folder] open through [open]: a changed file's diff, else the file or folder. */
fun fileLinks(folder: String, changes: List<TurnFileChange> = emptyList(), open: (FileLinkTarget) -> Unit): OpenLink =
    { value, inline -> fileLinkTarget(value, inline, folder, changes)?.let { target -> { open(target) } } }

/** What the blocks share; one per Markdown, so blocks that didn't change skip. */
@Immutable
internal class MdContext(
    val small: Boolean,
    val openPath: OpenLink?,
    val openWeb: (String) -> Unit,
    val image: ShowImage?,
) {
    /** A file first, then a web link; anything else stays text, as on the desktop. */
    fun link(href: String): (() -> Unit)? =
        openPath?.invoke(href, false) ?: if (isWebUrl(href)) ({ openWeb(href) }) else null

    fun code(code: String): (() -> Unit)? = openPath?.invoke(code.trim(), true)
}

/**
 * An agent's answer: the markdown agents actually write, drawn natively.
 * Web links go to [onLink] (the browser when null). Paths in the thread open
 * through [openPath]; without it, paths inside [folder] go to [onLink] too.
 * [selectable] lets held text select, across blocks; a streaming answer
 * re-parses only its last blocks.
 */
@Composable
fun Markdown(
    markdown: String,
    modifier: Modifier = Modifier,
    small: Boolean = false,
    onLink: ((String) -> Unit)? = null,
    folder: String? = null,
    openPath: OpenLink? = null,
    image: ShowImage? = null,
    selectable: Boolean = false,
) {
    val cache = remember { MarkdownCache() }
    val blocks = remember(markdown) { cache.blocks(markdown) }
    val uri = LocalUriHandler.current
    val context = remember(small, onLink, folder, openPath, image, uri) {
        val web = onLink ?: { href: String -> runCatching { uri.openUri(href) }; Unit }
        val paths = openPath ?: if (folder != null && onLink != null) {
            { value: String, inline: Boolean ->
                if (fileLinkTarget(value, inline, folder) != null) ({ onLink(value) }) else null
            }
        } else null
        MdContext(small, paths, web, image)
    }
    val content = @Composable {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (block in blocks) Block(block, context)
        }
    }
    if (selectable) SelectionContainer { content() } else content()
}

@Composable
internal fun bodyStyle(small: Boolean): TextStyle =
    if (small) RelayTheme.type.sm.copy(fontSize = 13.sp, lineHeight = 19.sp)
    else RelayTheme.type.base.copy(fontSize = 15.sp, lineHeight = 22.sp)

@Composable
private fun Block(block: MdBlock, ctx: MdContext) {
    val c = RelayTheme.colors
    when (block) {
        is MdBlock.Para -> Paragraph(block.inlines, ctx)
        is MdBlock.Heading -> Inlines(
            block.inlines,
            ctx,
            RelayTheme.type.base.copy(
                fontSize = when (block.level) { 1 -> 19.sp; 2 -> 17.sp; else -> 15.sp },
                lineHeight = 24.sp,
                fontWeight = FontWeight.SemiBold,
            ),
            Modifier.padding(top = 4.dp),
        )
        is MdBlock.Code -> CodeBlock(block.language, block.code)
        is MdBlock.Math -> MathBlock(block.tex, block.closed)
        is MdBlock.Quote -> {
            val border = c.border
            Column(
                Modifier
                    .drawBehind { drawRect(border, size = Size(3.dp.toPx(), size.height)) }
                    .padding(start = 15.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) { for (inner in block.blocks) Block(inner, ctx) }
        }
        is MdBlock.Items -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            block.items.forEachIndexed { i, item ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val bullet = when {
                        item.task != null -> if (item.task) "☑" else "☐"
                        block.ordered -> "${block.start + i}."
                        else -> "•"
                    }
                    Text(
                        bullet,
                        Modifier.widthIn(min = 16.dp),
                        style = bodyStyle(ctx.small),
                        color = c.mutedForeground,
                        textAlign = TextAlign.End,
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (inner in item.blocks) Block(inner, ctx)
                    }
                }
            }
        }
        is MdBlock.Table -> Table(block, ctx)
        is MdBlock.Raw -> Text(block.text, style = bodyStyle(ctx.small), color = c.foreground)
        MdBlock.Rule -> Divider(Modifier.padding(vertical = 6.dp))
    }
}

/** A web image stays a link in the text: loading it would tell its server the thread was read. */
private fun drawn(inline: MdInline) = inline is MdInline.Image && !isWebUrl(inline.src)

/**
 * A paragraph's text stays whole and its images follow it: text can't hold a
 * block, and an image that doesn't load then leaves the sentence as it reads.
 */
@Composable
private fun Paragraph(inlines: List<MdInline>, ctx: MdContext) {
    val images = if (ctx.image == null) emptyList() else inlines.filter(::drawn).map { it as MdInline.Image }
    if (images.isEmpty()) {
        Inlines(inlines, ctx, bodyStyle(ctx.small))
        return
    }
    val text = remember(inlines) { withoutImages(inlines) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (text.any { it !is MdInline.Plain || it.text.isNotBlank() }) Inlines(text, ctx, bodyStyle(ctx.small))
        for (image in images) ctx.image?.invoke(image.src, image.alt)
    }
}

/** "Before ![](a.png) after" reads "Before after", not with the image's two spaces. */
internal fun withoutImages(inlines: List<MdInline>): List<MdInline> {
    val out = ArrayList<MdInline>()
    var gap = false
    for (inline in inlines) {
        if (drawn(inline)) {
            gap = true
            continue
        }
        val before = out.lastOrNull()
        if (inline is MdInline.Plain && before is MdInline.Plain) {
            val joined = if (gap && before.text.lastOrNull()?.isWhitespace() == true) inline.text.trimStart() else inline.text
            out[out.size - 1] = MdInline.Plain(before.text + joined)
        } else out += inline
        gap = false
    }
    return out
}

@Composable
private fun Inlines(inlines: List<MdInline>, ctx: MdContext, style: TextStyle, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val text = remember(inlines, ctx, c) { inlineText(inlines, ctx, c) }
    RichText(text, modifier, style = style.copy(color = c.foreground))
}

@Composable
private fun Table(table: MdBlock.Table, ctx: MdContext) {
    val c = RelayTheme.colors
    val hairline = RelayTheme.hairline
    val cell = RelayTheme.type.sm.copy(fontSize = 13.sp)
    Column(Modifier.horizontalScroll(rememberScrollState())) {
        val rows = listOf(table.header) + table.rows
        rows.forEachIndexed { r, cells ->
            Row(
                Modifier.drawBehind {
                    val y = size.height - hairline.toPx() / 2
                    drawLine(c.border, Offset(0f, y), Offset(size.width, y), hairline.toPx())
                },
            ) {
                for (inlines in cells) {
                    Inlines(
                        inlines,
                        ctx,
                        if (r == 0) cell.copy(fontWeight = FontWeight.SemiBold) else cell,
                        Modifier.width(140.dp).padding(6.dp),
                    )
                }
            }
        }
    }
}
