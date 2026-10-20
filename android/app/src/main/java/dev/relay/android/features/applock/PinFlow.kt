package dev.relay.android.features.applock

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.theme.Motion
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What Settings asks the PIN for. iOS: `PinFlow.Kind`. */
enum class PinFlowKind { TurnOn, Change, TurnOff }

private enum class Step { Current, Choose, Confirm }

/**
 * Turning the lock on (choose a PIN, type it again), changing the PIN (the current one first) or
 * turning it off (the current one). Wrong current PINs count toward the lock screen's wait.
 */
@Composable
fun PinFlow(kind: PinFlowKind, lock: AppLock, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var step by remember { mutableStateOf(if (kind == PinFlowKind.TurnOn) Step.Choose else Step.Current) }
    var chosen by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf(false) }
    var shakes by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    val rise = remember { Animatable(1f) }
    LaunchedEffect(Unit) { rise.animateTo(0f, tween(Motion.SLIDE, easing = Motion.EaseOutQuint)) }

    suspend fun refuse(line: String?) {
        note = line
        error = true
        shakes++
        haptics.perform(Haptic.Error)
        delay(420)
        error = false
    }

    val typing = rememberPinTyping { pin ->
        busy = true
        scope.launch {
            delay(90)
            when (step) {
                Step.Current -> when (val result = lock.tryPin(pin)) {
                    Attempt.Unlocked -> {
                        clear()
                        note = null
                        if (kind == PinFlowKind.TurnOff) {
                            lock.turnOff()
                            haptics.perform(Haptic.Success)
                            onClose()
                        } else step = Step.Choose
                    }
                    is Attempt.Wrong -> {
                        refuse(if (result.waitMs > 0) LockWords.waitLine(result.waitMs) else LockWords.wrongLine(result.failures))
                        clear()
                    }
                    is Attempt.Waiting -> {
                        refuse(LockWords.waitLine(result.leftMs))
                        clear()
                    }
                }
                Step.Choose -> {
                    chosen = pin
                    clear()
                    note = null
                    step = Step.Confirm
                }
                Step.Confirm -> if (pin == chosen) {
                    if (kind == PinFlowKind.TurnOn) lock.turnOn(pin, biometrics = Biometrics.available(context))
                    else lock.changePin(pin)
                    haptics.perform(Haptic.Success)
                    onClose()
                } else {
                    refuse("Those didn't match. Choose a PIN again.")
                    clear()
                    chosen = ""
                    step = Step.Choose
                }
            }
            busy = false
        }
    }

    val (title, hint) = when (step) {
        Step.Current -> (if (kind == PinFlowKind.TurnOff) "Turn the lock off" else "Change PIN") to "Enter your current PIN"
        Step.Choose -> (if (kind == PinFlowKind.TurnOn) "Choose a PIN" else "Choose a new PIN") to
            "Six digits, asked for whenever Relay opens."
        Step.Confirm -> "Enter it again" to "To be sure it's the one you meant."
    }
    LockWindow(onBack = onClose) {
        Box(Modifier.fillMaxSize().graphicsLayer { translationY = rise.value * size.height * 0.12f; alpha = 1f - rise.value }) {
            PinPad(
                title = title,
                line = note ?: hint,
                typed = typing.text.length,
                onDigit = typing::digit,
                onDelete = typing::delete,
                error = error,
                warn = note != null,
                shakes = shakes,
                enabled = !busy,
                top = {
                    IconButton(
                        TablerIcons.Outline.X, "Cancel", onClose,
                        modifier = Modifier.align(Alignment.CenterStart).padding(start = 12.dp),
                    )
                },
            )
        }
    }
}
