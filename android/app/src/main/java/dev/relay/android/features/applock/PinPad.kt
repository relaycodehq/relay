package dev.relay.android.features.applock

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.R
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.Text
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.theme.Motion
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Backspace

/** A key beside 0: the phone's fingerprint or face, say. */
class PadKey(val icon: ImageVector, val label: String, val onClick: () -> Unit)

/**
 * The lock's face: Relay's mark, a title, a line under it, six dots and a keypad. Typing is the
 * caller's: it hears each digit and decides when six are in. [shakes] going up shakes the dots;
 * [error] flashes them red, [warn] keeps just the line red.
 */
@Composable
fun PinPad(
    title: String,
    line: String?,
    typed: Int,
    onDigit: (Char) -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    error: Boolean = false,
    warn: Boolean = false,
    shakes: Int = 0,
    enabled: Boolean = true,
    extra: PadKey? = null,
    top: (@Composable () -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val c = RelayTheme.colors
    Column(
        modifier.fillMaxSize().background(c.background).windowInsetsPadding(WindowInsets.safeDrawing),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.fillMaxWidth().height(56.dp)) { top?.invoke() }
        Spacer(Modifier.weight(1f))
        // The mark sits in the middle of a mostly empty square, as the splash draws it.
        Image(painterResource(R.drawable.splash_mark), null, Modifier.requiredSize(150.dp))
        Spacer(Modifier.height(4.dp))
        Text(title, style = RelayTheme.type.xl.copy(fontWeight = FontWeight.SemiBold), textAlign = TextAlign.Center)
        Text(
            line ?: "",
            Modifier.padding(top = 6.dp, start = 32.dp, end = 32.dp).heightIn(min = 40.dp),
            style = RelayTheme.type.sm,
            color = if (error || warn) c.destructive else c.mutedForeground,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
        Dots(typed, error, shakes)
        Spacer(Modifier.weight(1f))
        Keypad(enabled, onDigit, onDelete, canDelete = typed > 0, extra)
        Box(Modifier.fillMaxWidth().heightIn(min = 56.dp), contentAlignment = Alignment.Center) { footer?.invoke() }
    }
}

@Composable
private fun Dots(typed: Int, error: Boolean, shakes: Int) {
    val shift = remember { Animatable(0f) }
    LaunchedEffect(shakes) {
        if (shakes == 0) return@LaunchedEffect
        shift.animateTo(0f, keyframes {
            durationMillis = 420
            -14f at 50
            12f at 120
            -9f at 190
            6f at 260
            -3f at 330
        })
    }
    Row(
        Modifier.graphicsLayer { translationX = shift.value * density }.padding(vertical = 8.dp)
            .semantics { contentDescription = "$typed of ${LockWords.PIN_LENGTH} digits" },
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        repeat(LockWords.PIN_LENGTH) { i -> Dot(filled = i < typed, error = error) }
    }
}

@Composable
private fun Dot(filled: Boolean, error: Boolean) {
    val c = RelayTheme.colors
    val fill by animateColorAsState(
        when {
            error -> c.destructive
            filled -> c.foreground
            else -> c.foreground.copy(alpha = 0f)
        },
        tween(Motion.FAST), label = "dot",
    )
    val scale by animateFloatAsState(
        if (filled || error) 1f else 0.82f,
        spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium), label = "pop",
    )
    Box(
        Modifier.size(13.dp).graphicsLayer { scaleX = scale; scaleY = scale }
            .border(1.5.dp, c.foreground.copy(alpha = if (filled || error) 0f else 0.25f), CircleShape)
            .background(fill, CircleShape),
    )
}

@Composable
private fun Keypad(enabled: Boolean, onDigit: (Char) -> Unit, onDelete: () -> Unit, canDelete: Boolean, extra: PadKey?) {
    val haptics = rememberHaptics()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        for (row in listOf("123", "456", "789")) {
            Row(horizontalArrangement = Arrangement.spacedBy(26.dp)) {
                row.forEach { d -> DigitKey(d, enabled) { haptics.perform(Haptic.Selection); onDigit(d) } }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(26.dp)) {
            if (extra != null) IconKey(extra.icon, extra.label, enabled, extra.onClick) else Spacer(Modifier.size(KEY))
            DigitKey('0', enabled) { haptics.perform(Haptic.Selection); onDigit('0') }
            if (canDelete) IconKey(TablerIcons.Outline.Backspace, "Delete", enabled) { haptics.perform(Haptic.Light); onDelete() }
            else Spacer(Modifier.size(KEY))
        }
    }
}

@Composable
private fun DigitKey(digit: Char, enabled: Boolean, onClick: () -> Unit) {
    KeyBox(filled = true, label = "$digit", enabled = enabled, onClick = onClick) {
        Text("$digit", style = RelayTheme.type.base.copy(fontSize = 30.sp, fontWeight = FontWeight.Normal))
    }
}

@Composable
private fun IconKey(icon: ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    KeyBox(filled = false, label = label, enabled = enabled, onClick = onClick) {
        Icon(icon, null, Modifier.size(28.dp), tint = RelayTheme.colors.foreground)
    }
}

@Composable
private fun KeyBox(filled: Boolean, label: String, enabled: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    val c = RelayTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val fill by animateColorAsState(
        when {
            pressed -> c.foreground.copy(alpha = 0.16f)
            filled -> c.foreground.copy(alpha = 0.06f)
            else -> c.foreground.copy(alpha = 0f)
        },
        tween(if (pressed) 40 else Motion.BASE), label = "key",
    )
    val scale by animateFloatAsState(if (pressed) 0.94f else 1f, tween(Motion.FAST, easing = Motion.EaseOutQuint), label = "press")
    Box(
        Modifier.size(KEY).graphicsLayer { scaleX = scale; scaleY = scale; alpha = if (enabled) 1f else 0.4f }
            .background(fill, CircleShape)
            .clickable(interaction, null, enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { content() }
}

private val KEY = 76.dp
