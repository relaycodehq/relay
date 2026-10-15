package dev.relay.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.theme.RelayColors
import dev.relay.android.ui.theme.RelayTheme

enum class ButtonVariant { Default, Secondary, Outline, Ghost, Destructive, GhostDestructive }

enum class ButtonSize(val height: Dp, val padX: Dp, val icon: Dp, val radius: Dp) {
    Xs(24.dp, 8.dp, 14.dp, 7.7.dp),
    Sm(32.dp, 10.dp, 16.dp, 10.dp),
    Default(36.dp, 12.dp, 16.dp, 10.2.dp),
    Lg(40.dp, 14.dp, 16.dp, 10.2.dp),
}

@Immutable
private data class Look(val fill: Color, val pressedFill: Color, val content: Color, val ring: Color?)

private fun look(v: ButtonVariant, c: RelayColors): Look {
    val pressMuted = c.foreground.copy(alpha = 0.06f).compositeOver(c.muted)
    return when (v) {
        ButtonVariant.Default -> Look(c.primary, c.primary.copy(alpha = 0.8f), c.onPrimary, null)
        ButtonVariant.Secondary -> Look(c.muted, pressMuted, c.foreground, null)
        ButtonVariant.Outline -> Look(
            if (c.isDark) c.input.copy(alpha = c.input.alpha * 0.3f).compositeOver(c.background) else c.background,
            c.muted,
            c.foreground,
            if (c.isDark) c.input else c.border,
        )
        ButtonVariant.Ghost -> Look(Color.Transparent, c.muted, c.foreground, null)
        ButtonVariant.Destructive -> {
            val tint = if (c.isDark) 0.2f else 0.1f
            Look(c.destructive.copy(alpha = tint), c.destructive.copy(alpha = tint + 0.1f), c.destructive, null)
        }
        ButtonVariant.GhostDestructive -> Look(Color.Transparent, c.destructive.copy(alpha = 0.1f), c.destructive, null)
    }
}

/**
 * Hexta's button. `loading` swaps the leading icon for a spinner and ignores
 * taps. Destructive is a tint, not a solid fill.
 */
@Composable
fun Button(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Default,
    size: ButtonSize = ButtonSize.Default,
    leadingIcon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    loading: Boolean = false,
    enabled: Boolean = true,
    haptic: Haptic? = null,
) {
    ButtonBox(onClick, modifier, variant, size, enabled && !loading, dim = !enabled, square = false, label = text, haptic = haptic) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (leadingIcon != null || loading) {
                AnimatedContent(
                    loading,
                    transitionSpec = {
                        (fadeIn(tween(150)) + scaleIn(tween(150), 0.6f)) togetherWith
                            (fadeOut(tween(100)) + scaleOut(tween(100), 0.6f))
                    },
                    label = "loading",
                ) { busy ->
                    if (busy) Spinner(size = size.icon)
                    else if (leadingIcon != null) Icon(leadingIcon, null, size = size.icon)
                }
            }
            Text(
                text,
                style = if (size == ButtonSize.Xs) RelayTheme.type.xs.copy(fontWeight = RelayTheme.type.label.fontWeight) else RelayTheme.type.label,
                color = androidx.compose.material3.LocalContentColor.current,
                maxLines = 1,
            )
            if (trailingIcon != null) Icon(trailingIcon, null, size = size.icon)
        }
    }
}

/** A square button holding one icon; ghost by default. */
@Composable
fun IconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Default,
    enabled: Boolean = true,
    loading: Boolean = false,
    tint: Color? = null,
    haptic: Haptic? = null,
) {
    ButtonBox(onClick, modifier, variant, size, enabled && !loading, dim = !enabled, square = true, label = contentDescription, haptic = haptic) {
        if (loading) Spinner(size = size.icon)
        else Icon(icon, null, size = if (size == ButtonSize.Lg) 20.dp else size.icon, tint = tint ?: androidx.compose.material3.LocalContentColor.current)
    }
}

@Composable
private fun ButtonBox(
    onClick: () -> Unit,
    modifier: Modifier,
    variant: ButtonVariant,
    size: ButtonSize,
    enabled: Boolean,
    dim: Boolean,
    square: Boolean,
    label: String,
    haptic: Haptic? = null,
    content: @Composable () -> Unit,
) {
    val c = RelayTheme.colors
    val l = remember(variant, c) { look(variant, c) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(size.radius)
    Box(
        modifier
            .pressable(onClick, enabled = enabled, haptic = haptic, interaction = interaction)
            .then(if (square) Modifier.size(size.height) else Modifier.height(size.height).defaultMinSize(minWidth = size.height))
            .alpha(if (dim) 0.5f else 1f)
            .clip(shape)
            .background(if (pressed && enabled) l.pressedFill else l.fill)
            .then(if (l.ring != null) Modifier.ring(l.ring, shape) else Modifier)
            .then(if (square) Modifier.semantics { contentDescription = label } else Modifier)
            .padding(horizontal = if (square) 0.dp else size.padX),
        contentAlignment = Alignment.Center,
    ) {
        ContentColor(l.content, content)
    }
}
