package dev.relay.android.features.markdown

import android.content.Context
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Layout
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.method.ArrowKeyMovementMethod
import android.text.method.LinkMovementMethod
import android.text.style.BackgroundColorSpan
import android.text.style.ClickableSpan
import android.text.style.ForegroundColorSpan
import android.text.style.MetricAffectingSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.TextView
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.isUnspecified
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.res.ResourcesCompat
import dev.relay.android.R
import dev.relay.android.ui.theme.RelayColors
import dev.relay.android.ui.theme.RelayTheme
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

/*
 * An answer's text as Android's own TextView. Compose's selection handles
 * catch only about 25dp around them, so a touch just below one cleared the
 * selection and the menu flickered; the system's handles, magnifier and menu
 * are the ones the rest of the phone has. Each paragraph is a view of its own,
 * so a selection stays within it; code blocks and tables keep Compose's.
 */

/** [inlines] in [style], selectable when [selectable]; links and paths open through [ctx]. */
@Composable
internal fun NativeInlines(inlines: List<MdInline>, ctx: MdContext, style: TextStyle, selectable: Boolean, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val density = LocalDensity.current
    val context = LocalContext.current
    val mono = Fonts.mono(context)
    val inter = Fonts.inter(context)
    val text = remember(inlines, ctx, c, density, mono, inter) { spannedOf(inlines, ctx, c, density, mono, inter) }
    val weight = (style.fontWeight ?: FontWeight.Normal).weight
    AndroidView(
        factory = { context -> TextView(context).apply { setUp(context) } },
        modifier = modifier.fillMaxWidth(),
        onReset = {},
        update = { view ->
            view.applyStyle(StyleKey(style, weight, c), density)
            view.show(text, selectable)
        },
    )
}

/** What a view last showed, so a parent drawing again with the same doesn't reset it. */
private class Shown(var style: StyleKey? = null, var text: Spanned? = null)

private data class StyleKey(val style: TextStyle, val weight: Int, val colors: RelayColors)

private fun TextView.setUp(context: Context) {
    tag = Shown()
    typeface = Fonts.inter(context)
    includeFontPadding = false
    hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
    breakStrategy = Layout.BREAK_STRATEGY_HIGH_QUALITY
}

private fun TextView.applyStyle(key: StyleKey, density: Density) {
    val shown = tag as Shown
    if (shown.style == key) return
    shown.style = key
    val (style, weight, c) = key
    typeface = Fonts.weighted(Fonts.inter(context), weight)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, style.fontSize.value)
    if (style.lineHeight.isSp) lineHeight = with(density) { style.lineHeight.toPx() }.roundToInt()
    setTextColor((if (style.color.isUnspecified) c.foreground else style.color).toArgb())
    highlightColor = c.accent.copy(alpha = 0.3f).toArgb()
    for (handle in listOfNotNull(textSelectHandle, textSelectHandleLeft, textSelectHandleRight)) handle.mutate().setTint(c.accent.toArgb())
    textSelectHandle?.let(::setTextSelectHandle)
    textSelectHandleLeft?.let(::setTextSelectHandleLeft)
    textSelectHandleRight?.let(::setTextSelectHandleRight)
}

/**
 * Sets [text] unless the same words are already up with a selection on them:
 * a parent drawing again hands over new link actions for the same answer, and
 * setting them would drop what the reader is holding.
 */
private fun TextView.show(text: Spanned, selectable: Boolean) {
    val shown = tag as Shown
    if (isTextSelectable != selectable) {
        setTextIsSelectable(selectable)
        shown.text = null
    }
    val links = if (selectable) SelectableLinks else LinkMovementMethod.getInstance()
    if (movementMethod !== links) movementMethod = links
    if (shown.text === text || hasSelection() && this.text.toString() == text.toString()) return
    shown.text = text
    setText(text, TextView.BufferType.SPANNABLE)
}

private object Fonts {
    @Volatile private var inter: Typeface? = null
    @Volatile private var mono: Typeface? = null

    fun inter(context: Context): Typeface =
        inter ?: (ResourcesCompat.getFont(context, R.font.inter_variable) ?: Typeface.DEFAULT).also { inter = it }

    fun mono(context: Context): Typeface =
        mono ?: (ResourcesCompat.getFont(context, R.font.jetbrains_mono_regular) ?: Typeface.MONOSPACE).also { mono = it }

    private val weights = ConcurrentHashMap<Pair<Typeface, Int>, Typeface>()

    /**
     * [base] at [weight] on its variable axis, made once. A paint told the variation itself builds
     * a new font every time, and text measures and draws each bold run with a paint it resets:
     * that was a quarter of the time a fast scroll up a long thread spent.
     */
    fun weighted(base: Typeface, weight: Int): Typeface = weights.getOrPut(base to weight) {
        Paint().apply { typeface = base; fontVariationSettings = "'wght' $weight" }.typeface
    }
}

/** The same marks InlineText draws in Compose, as Android spans. */
private fun spannedOf(inlines: List<MdInline>, ctx: MdContext, c: RelayColors, density: Density, mono: Typeface, inter: Typeface): Spanned {
    val code = Code(mono, with(density) { 13.5.sp.toPx() })
    val strong = Weight(Fonts.weighted(inter, 600))
    return SpannableStringBuilder().apply { appendInlines(inlines, ctx, c, code, strong, inLink = false) }
}

private fun SpannableStringBuilder.appendInlines(inlines: List<MdInline>, ctx: MdContext, c: RelayColors, code: Code, strong: Weight, inLink: Boolean) {
    for (inline in inlines) when (inline) {
        is MdInline.Plain -> append(inline.text)
        is MdInline.Strong -> span(strong.copy()) { appendInlines(inline.children, ctx, c, code, strong, inLink) }
        is MdInline.Em -> span(StyleSpan(Typeface.ITALIC)) { appendInlines(inline.children, ctx, c, code, strong, inLink) }
        is MdInline.Del -> span(StrikethroughSpan()) { appendInlines(inline.children, ctx, c, code, strong, inLink) }
        is MdInline.Math -> {
            val plain = texToPlain(inline.tex)
            if (plain == null) span(code.copy(), ForegroundColorSpan(c.mutedForeground.toArgb())) { append(inline.tex) }
            else span(TypefaceSpan(Typeface.SERIF), StyleSpan(Typeface.ITALIC)) { append(plain) }
        }
        is MdInline.Code -> {
            val open = if (inLink) null else ctx.code(inline.code)
            val marks = listOfNotNull<Any>(
                code.copy(),
                BackgroundColorSpan(c.code.toArgb()),
                ForegroundColorSpan((if (open != null) c.accent else c.foreground).toArgb()),
                open?.let { Click(it, null) },
            )
            span(*marks.toTypedArray()) { append(inline.code) }
        }
        is MdInline.Link -> link(inline.href, ctx, c, inLink) { appendInlines(inline.children, ctx, c, code, strong, inLink = true) }
        is MdInline.Image ->
            if (isWebUrl(inline.src)) link(inline.src, ctx, c, inLink) { append(inline.alt.ifEmpty { inline.src }) }
            else append(inline.alt)
    }
}

private inline fun SpannableStringBuilder.link(href: String, ctx: MdContext, c: RelayColors, inLink: Boolean, body: SpannableStringBuilder.() -> Unit) {
    val open = if (inLink) null else ctx.link(href)
    if (open == null) body() else span(Click(open, c.accent)) { body() }
}

private inline fun SpannableStringBuilder.span(vararg marks: Any, body: SpannableStringBuilder.() -> Unit) {
    val start = length
    body()
    for (mark in marks) setSpan(mark, start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
}

/** Inter at a weight made beforehand ([Fonts.weighted]); each use takes a copy, as a span marks one range. */
private class Weight(private val face: Typeface) : MetricAffectingSpan() {
    fun copy() = Weight(face)
    override fun updateMeasureState(paint: TextPaint) = apply(paint)
    override fun updateDrawState(paint: TextPaint) = apply(paint)
    private fun apply(paint: TextPaint) {
        paint.typeface = face
    }
}

/** JetBrains Mono at InlineText's 13.5sp; each use takes a copy, as a span marks one range. */
private class Code(private val mono: Typeface, private val sizePx: Float) : MetricAffectingSpan() {
    fun copy() = Code(mono, sizePx)
    override fun updateMeasureState(paint: TextPaint) = apply(paint)
    override fun updateDrawState(paint: TextPaint) = apply(paint)
    private fun apply(paint: TextPaint) {
        paint.typeface = mono
        paint.textSize = sizePx
    }
}

/**
 * Selection as setTextIsSelectable gives it, plus link taps: TextView opens
 * links in selectable text only when it found them itself (autoLink), and
 * LinkMovementMethod selects the link it opens. A tap that clears a selection
 * doesn't also follow the link under it.
 */
private object SelectableLinks : ArrowKeyMovementMethod() {
    private var selectedAtDown = false

    override fun onTouchEvent(widget: TextView, buffer: Spannable, event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> selectedAtDown = widget.hasSelection()
            MotionEvent.ACTION_UP -> if (!selectedAtDown && event.eventTime - event.downTime < ViewConfiguration.getLongPressTimeout()) {
                linkAt(widget, buffer, event)?.let { link ->
                    link.onClick(widget)
                    return true
                }
            }
        }
        return super.onTouchEvent(widget, buffer, event)
    }

    private fun linkAt(widget: TextView, buffer: Spannable, event: MotionEvent): ClickableSpan? {
        val layout = widget.layout ?: return null
        val x = event.x - widget.totalPaddingLeft + widget.scrollX
        val y = event.y.toInt() - widget.totalPaddingTop + widget.scrollY
        val line = layout.getLineForVertical(y)
        if (x < layout.getLineLeft(line) || x > layout.getLineRight(line)) return null
        val at = layout.getOffsetForHorizontal(line, x)
        return buffer.getSpans(at, at, ClickableSpan::class.java).firstOrNull()
    }
}

/** A link or path: the accent colour without an underline, or the text's own colour for code. */
private class Click(private val open: () -> Unit, private val color: Color?) : ClickableSpan() {
    override fun onClick(widget: View) = open()

    override fun updateDrawState(paint: TextPaint) {
        if (color != null) paint.color = color.toArgb()
        paint.isUnderlineText = false
    }
}
