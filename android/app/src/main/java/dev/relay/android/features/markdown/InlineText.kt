package dev.relay.android.features.markdown

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import dev.relay.android.ui.theme.JetBrainsMono
import dev.relay.android.ui.theme.RelayColors

private val WEB = Regex("^https?://", RegexOption.IGNORE_CASE)

internal fun isWebUrl(href: String) = WEB.containsMatchIn(href)

/** A paragraph's inline markdown as one styled, tappable string. */
internal fun inlineText(inlines: List<MdInline>, ctx: MdContext, c: RelayColors): AnnotatedString =
    buildAnnotatedString { appendInlines(inlines, ctx, c, inLink = false) }

private fun AnnotatedString.Builder.appendInlines(
    inlines: List<MdInline>,
    ctx: MdContext,
    c: RelayColors,
    inLink: Boolean,
) {
    val mono = SpanStyle(fontFamily = JetBrainsMono, fontSize = 13.5.sp)
    for (inline in inlines) when (inline) {
        is MdInline.Plain -> append(inline.text)
        is MdInline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendInlines(inline.children, ctx, c, inLink) }
        is MdInline.Em -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInlines(inline.children, ctx, c, inLink) }
        is MdInline.Del -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
            appendInlines(inline.children, ctx, c, inLink)
        }
        // A formula inside a sentence as plain text; one that can't be stays as its source.
        is MdInline.Math -> {
            val plain = texToPlain(inline.tex)
            if (plain == null) withStyle(mono.copy(color = c.mutedForeground)) { append(inline.tex) }
            else withStyle(SpanStyle(fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic)) { append(plain) }
        }
        // Inline code; a path in the thread's folder opens, in the accent colour.
        is MdInline.Code -> {
            val open = if (inLink) null else ctx.code(inline.code)
            val style = mono.copy(background = c.code, color = if (open != null) c.accent else c.foreground)
            if (open == null) withStyle(style) { append(inline.code) }
            else withLink(clickable(open, style)) { append(inline.code) }
        }
        is MdInline.Link -> link(inline.href, ctx, c, inLink) { appendInlines(inline.children, ctx, c, inLink = true) }
        // A web image is a link; any other gets here only inside a link or emphasis, where a block can't go.
        is MdInline.Image ->
            if (isWebUrl(inline.src)) link(inline.src, ctx, c, inLink) { append(inline.alt.ifEmpty { inline.src }) }
            else append(inline.alt)
    }
}

private inline fun AnnotatedString.Builder.link(
    href: String,
    ctx: MdContext,
    c: RelayColors,
    inLink: Boolean,
    body: AnnotatedString.Builder.() -> Unit,
) {
    val open = if (inLink) null else ctx.link(href)
    if (open == null) body() else withLink(clickable(open, SpanStyle(color = c.accent)), body)
}

private fun clickable(open: () -> Unit, style: SpanStyle) =
    LinkAnnotation.Clickable("link", TextLinkStyles(style)) { open() }
