package dev.relay.android.features.applock

import android.app.Activity
import android.content.Context
import android.os.CancellationSignal
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.theme.Motion
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Fingerprint
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Over everything while [AppLock.locked]: back sends Relay to the background rather than past
 * the lock. Unlocked, it fades and grows away instead of vanishing.
 */
@Composable
fun LockOverlay(lock: AppLock, forgetComputers: suspend () -> Unit) {
    val locked by lock.locked.collectAsState()
    var shown by remember { mutableStateOf(locked) }
    val fade = remember { Animatable(1f) }
    LaunchedEffect(locked) {
        if (locked) {
            fade.snapTo(1f)
            shown = true
        } else if (shown) {
            fade.animateTo(0f, tween(280, easing = Motion.EaseOutQuint))
            shown = false
        }
    }
    if (!shown) return
    // The activity, outside the dialog: the prompt and moving to the back want it.
    val activity = LocalContext.current as? Activity
    LockWindow(onBack = { activity?.moveTaskToBack(true) }) {
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                alpha = fade.value
                val grow = 1f + (1f - fade.value) * 0.06f
                scaleX = grow
                scaleY = grow
            },
        ) {
            if (activity != null) LockScreen(lock, activity, forgetComputers)
        }
    }
}

@Composable
private fun LockScreen(lock: AppLock, activity: Context, forgetComputers: suspend () -> Unit) {
    val settings by lock.settings.collectAsState()
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var wrong by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf(false) }
    var shakes by remember { mutableIntStateOf(0) }
    var checking by remember { mutableStateOf(false) }
    var forgetAsked by remember { mutableStateOf(false) }
    val waitLeft by rememberWaitLeft(settings.waitUntil)

    val typing = rememberPinTyping { pin ->
        checking = true
        scope.launch {
            // Long enough to see the last dot fill.
            delay(90)
            when (val result = lock.tryPin(pin)) {
                Attempt.Unlocked -> haptics.perform(Haptic.Success)
                is Attempt.Wrong -> {
                    wrong = if (result.waitMs > 0) null else LockWords.wrongLine(result.failures)
                    error = true
                    shakes++
                    haptics.perform(Haptic.Error)
                    delay(420)
                    error = false
                    clear()
                }
                is Attempt.Waiting -> clear()
            }
            checking = false
        }
    }

    val biometrics = settings.biometrics && remember { Biometrics.available(activity) }
    var prompt by remember { mutableStateOf<CancellationSignal?>(null) }
    fun ask() {
        prompt?.cancel()
        prompt = Biometrics.prompt(activity) { ok ->
            prompt = null
            if (ok) {
                haptics.perform(Haptic.Success)
                lock.unlockWithBiometrics()
            }
        }
    }
    // Once per locking, when Relay is in front: a prompt asked for in the background just fails.
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner, biometrics) {
        if (!biometrics) return@LaunchedEffect
        var asked = false
        owner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (!asked && waitLeft == 0L) {
                asked = true
                ask()
            }
        }
    }
    DisposableEffect(Unit) { onDispose { prompt?.cancel() } }

    val waiting = waitLeft > 0
    PinPad(
        title = "Relay is locked",
        line = when {
            waiting -> LockWords.waitLine(waitLeft)
            wrong != null -> wrong
            else -> "Enter your PIN"
        },
        typed = typing.text.length,
        onDigit = { wrong = null; typing.digit(it) },
        onDelete = typing::delete,
        error = error,
        warn = waiting || wrong != null,
        shakes = shakes,
        enabled = !checking && !waiting,
        extra = if (biometrics) PadKey(TablerIcons.Outline.Fingerprint, Biometrics.label(activity)) { ask() } else null,
        footer = {
            Button("Forgot PIN?", { forgetAsked = true }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        },
    )
    if (forgetAsked) ConfirmDialog(
        "Forget every computer?",
        onConfirm = {
            forgetAsked = false
            scope.launch {
                forgetComputers()
                lock.reset()
            }
        },
        onDismiss = { forgetAsked = false },
        message = "Without the PIN, the way back in is to start over: Relay forgets every computer paired " +
            "on this phone and the lock, and you pair them again.",
        confirmText = "Forget all",
        destructive = true,
    )
}

/** Ms left of a wait for another try, ticking down each second; 0 when there's none. */
@Composable
private fun rememberWaitLeft(until: Long): State<Long> = produceState(0L, until) {
    while (true) {
        value = (until - System.currentTimeMillis()).coerceAtLeast(0)
        if (value == 0L) break
        delay(value % 1000 + 1)
    }
}
