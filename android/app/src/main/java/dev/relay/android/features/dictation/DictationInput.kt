package dev.relay.android.features.dictation

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

/**
 * The composer side of dictation (mobile/src/ui/Composer.tsx's target): words
 * go in at the cursor while typing, after the draft otherwise, and are
 * respaced and recased against the text around them as they settle.
 *
 * Hold one per composer (`remember { DictationInput(...) }`) and pass
 * `{ input }` as DictationButton's target; the composer's own `value` stays
 * the source of truth.
 */
class DictationInput(
    private val value: () -> TextFieldValue,
    private val setValue: (TextFieldValue) -> Unit,
    private val focused: () -> Boolean,
) : DictationTarget {
    private class Live(val base: String, val from: Int, val to: Int)

    private var live: Live? = null

    /** The draft as the last dictation left it, for a send that waited on it. */
    var dictated: String = ""
        private set

    /** Whether words are coming in; the composer may hold its Send meanwhile. */
    val active get() = live != null

    override fun begin() {
        val now = value()
        val base = now.text
        val at = if (focused()) now.selection else TextRange(base.length)
        val from = minOf(at.min, base.length)
        val to = minOf(maxOf(from, at.max), base.length)
        live = Live(base, from, to)
    }

    override fun update(settled: String, tentative: String) {
        val current = live ?: return
        val placed = placeDictation(
            current.base, current.from, current.to,
            listOf(settled, tentative).filter { it.isNotEmpty() }.joinToString(" "),
        )
        setValue(TextFieldValue(placed.text, TextRange(placed.end)))
    }

    override fun end(text: String?) {
        val current = live ?: return
        live = null
        val placed = placeDictation(current.base, current.from, current.to, text ?: "")
        dictated = if (text != null) placed.text else current.base
        setValue(TextFieldValue(dictated, TextRange(if (text != null) placed.end else current.from)))
    }
}
