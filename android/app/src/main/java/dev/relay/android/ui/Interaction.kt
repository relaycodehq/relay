package dev.relay.android.ui

import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.RelayTheme

/** Hexta's inset hairline ring: one physical pixel, drawn inside the shape. */
@Composable
fun Modifier.ring(color: Color = RelayTheme.colors.border, shape: Shape): Modifier =
    border(BorderStroke(RelayTheme.hairline, color), shape)

/** Hexta's tactile press: scale to 0.97 and sink 1dp while held. */
@Composable
fun Modifier.pressScale(interaction: MutableInteractionSource, enabled: Boolean = true): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val on = pressed && enabled
    val scale by animateFloatAsState(if (on) 0.97f else 1f, tween(Motion.FAST, easing = Motion.EaseOutQuint), label = "press")
    val sink = with(LocalDensity.current) { 1.dp.toPx() }
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
        translationY = (1f - scale) / 0.03f * sink
    }
}

/**
 * A tap target without Material's ripple: press scale, optional haptic, and a
 * long press. Rows that highlight instead of scaling pass `scale = false`.
 */
@Composable
fun Modifier.pressable(
    onClick: () -> Unit,
    enabled: Boolean = true,
    onLongClick: (() -> Unit)? = null,
    role: Role? = Role.Button,
    haptic: Haptic? = null,
    scale: Boolean = true,
    interaction: MutableInteractionSource = remember { MutableInteractionSource() },
): Modifier {
    val haptics = rememberHaptics()
    val click by rememberUpdatedState(onClick)
    val pressed = if (scale) pressScale(interaction, enabled) else Modifier
    val tap = {
        haptic?.let(haptics::perform)
        click()
    }
    return this.then(pressed).then(
        if (onLongClick != null)
            Modifier.combinedClickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                role = role,
                onLongClick = {
                    haptics.perform(Haptic.Long)
                    onLongClick()
                },
                onClick = tap,
            )
        else Modifier.clickable(interaction, null, enabled = enabled, role = role, onClick = tap),
    )
}

/** The phone app's haptic vocabulary (expo-haptics' names), mapped to Android's constants. */
enum class Haptic { Light, Medium, Selection, Success, Warning, Error, Long }

class Haptics(private val view: View) {
    fun perform(kind: Haptic) {
        val r = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        val constant = when (kind) {
            Haptic.Light -> HapticFeedbackConstants.CLOCK_TICK
            Haptic.Medium -> HapticFeedbackConstants.CONTEXT_CLICK
            Haptic.Selection -> HapticFeedbackConstants.KEYBOARD_TAP
            Haptic.Success -> if (r) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.CONTEXT_CLICK
            Haptic.Warning -> if (r) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            Haptic.Error -> if (r) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            Haptic.Long -> HapticFeedbackConstants.LONG_PRESS
        }
        view.performHapticFeedback(constant)
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) { Haptics(view) }
}

/** Whether the app is in front; endless animations stop when it isn't. */
@Composable
fun rememberInFront(): State<Boolean> {
    val state by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    return remember { derivedStateOf { state.isAtLeast(Lifecycle.State.RESUMED) } }
}

/** The system's "remove animations" (animator scale 0). */
@Composable
fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
