package dev.relay.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Search
import io.github.lyxnx.compose.ui.tablericons.outline.X
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import kotlin.math.roundToInt

/**
 * Hexta's input: transparent (dark: input at 30%), hairline ring that
 * darkens on focus, destructive ring plus a shake when `error` turns up.
 * Multiline when `singleLine` is false. `maxLength` shows a counter.
 */
@Composable
fun TextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    label: String? = null,
    leadingIcon: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 8,
    error: String? = null,
    maxLength: Int? = null,
    enabled: Boolean = true,
    mono: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    focusRequester: FocusRequester? = null,
) {
    val c = RelayTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Radii.md)
    val shake = remember { Animatable(0f) }
    LaunchedEffect(error) {
        if (error != null) shake.animateTo(0f, keyframes {
            durationMillis = 360
            -6f at 60; 6f at 120; -4f at 180; 4f at 240; -2f at 300
        })
    }
    val px = with(LocalDensity.current) { 1.dp.toPx() }
    val ringColor = when {
        error != null -> c.destructive
        focused -> c.ring
        else -> c.input
    }
    val text = (if (mono) RelayTheme.type.mono.copy(fontSize = RelayTheme.type.input.fontSize) else RelayTheme.type.input).copy(color = c.foreground)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) Text(label, style = RelayTheme.type.label)
        BasicTextField(
            value = value,
            onValueChange = { if (maxLength == null || it.length <= maxLength) onValueChange(it) },
            modifier = Modifier.fillMaxWidth()
                .offset { IntOffset((shake.value * px).roundToInt(), 0) }
                .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier),
            enabled = enabled,
            textStyle = text,
            singleLine = singleLine,
            minLines = minLines,
            maxLines = maxLines,
            keyboardOptions = if (singleLine && keyboardOptions == KeyboardOptions.Default) KeyboardOptions(imeAction = ImeAction.Done) else keyboardOptions,
            keyboardActions = keyboardActions,
            interactionSource = interaction,
            cursorBrush = SolidColor(c.foreground),
            decorationBox = { field ->
                Row(
                    Modifier.fillMaxWidth()
                        .heightIn(min = 40.dp)
                        .background(if (c.isDark) c.input.copy(alpha = c.input.alpha * 0.3f) else androidx.compose.ui.graphics.Color.Transparent, shape)
                        .ring(ringColor, shape)
                        .then(if (focused && error == null) Modifier.ring(c.foreground.copy(alpha = 0.15f), shape) else Modifier)
                        .padding(horizontal = 12.dp, vertical = if (singleLine) 0.dp else 9.dp),
                    verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (leadingIcon != null) Icon(leadingIcon, null, tint = c.mutedForeground, modifier = Modifier.padding(top = if (singleLine) 0.dp else 3.dp))
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null)
                            Text(placeholder, style = text, color = c.faint, maxLines = if (singleLine) 1 else Int.MAX_VALUE)
                        field()
                    }
                    if (trailing != null) trailing()
                }
            },
        )
        if (error != null || maxLength != null) Row(Modifier.fillMaxWidth()) {
            Text(error ?: "", Modifier.weight(1f), style = RelayTheme.type.xs, color = c.destructive)
            if (maxLength != null) Text(
                "${value.length}/$maxLength",
                style = RelayTheme.type.xs,
                color = if (value.length >= maxLength) c.destructive else c.faint,
                textAlign = TextAlign.End,
            )
        }
    }
}

/** A text field with a search glass and a clear button. */
@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search",
    focusRequester: FocusRequester? = null,
) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        placeholder = placeholder,
        leadingIcon = TablerIcons.Outline.Search,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        focusRequester = focusRequester,
        trailing = if (value.isNotEmpty()) ({
            IconButton(TablerIcons.Outline.X, "Clear", { onValueChange("") }, size = ButtonSize.Xs)
        }) else null,
    )
}
