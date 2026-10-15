package dev.relay.android.features.composer

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import kotlin.reflect.KProperty

/**
 * The composer's text as a TextFieldValue over a TextFieldState: only the state-based field
 * takes images from the keyboard, while the draft and dictation code thinks in values.
 */
internal class TextFieldValueBridge(private val state: TextFieldState) {
    operator fun getValue(thisRef: Any?, property: KProperty<*>) = TextFieldValue(state.text.toString(), state.selection)

    operator fun setValue(thisRef: Any?, property: KProperty<*>, value: TextFieldValue) {
        if (value.text == state.text.toString() && value.selection == state.selection) return
        state.edit {
            if (value.text != toString()) replace(0, length, value.text)
            selection = TextRange(value.selection.start.coerceIn(0, length), value.selection.end.coerceIn(0, length))
        }
    }
}

internal fun TextFieldState.asValue() = TextFieldValueBridge(this)
