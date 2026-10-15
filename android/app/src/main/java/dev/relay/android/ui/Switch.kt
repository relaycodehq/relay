package dev.relay.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.RelayTheme

/** Hexta's switch: 36×20 track, primary when on, input colour when off. */
@Composable
fun Switch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val c = RelayTheme.colors
    val haptics = rememberHaptics()
    val track by animateColorAsState(if (checked) c.primary else c.input, tween(Motion.BASE), label = "track")
    val knob by animateDpAsState(if (checked) 16.dp else 0.dp, tween(Motion.BASE, easing = Motion.EaseOutQuint), label = "knob")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier
            .toggleable(checked, interaction, null, enabled, Role.Switch) {
                haptics.perform(Haptic.Selection)
                onCheckedChange(it)
            }
            .pressScale(interaction, enabled)
            .alpha(if (enabled) 1f else 0.5f)
            .size(36.dp, 20.dp)
            .background(track, CircleShape)
            .padding(2.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            Modifier.offset(x = knob).size(16.dp).shadow(1.dp, CircleShape)
                .background(if (checked) c.onPrimary else if (c.isDark) c.foreground else c.background, CircleShape),
        )
    }
}
