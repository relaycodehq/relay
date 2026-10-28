package dev.relay.android.features.thread

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme

/** Fetches a folded turn's steps into the thread; false when they couldn't be had. Only the thread screen has one. */
internal val LocalTurnSteps = staticCompositionLocalOf<(suspend (String) -> Boolean)?> { null }

/** A folded turn's steps on their way from the desktop; a failed fetch offers another go. */
@Composable
internal fun StepsComing(messageId: String, load: suspend (String) -> Boolean) {
    var attempt by remember(messageId) { mutableIntStateOf(0) }
    var failed by remember(messageId) { mutableStateOf(false) }
    LaunchedEffect(messageId, attempt) { failed = !load(messageId) }
    val muted = RelayTheme.colors.mutedForeground
    Column(Modifier.padding(top = 6.dp)) {
        if (failed) Step(Modifier.pressable(onClick = { failed = false; attempt++ }, scale = false)) {
            Text("Couldn't load the steps. Tap to try again.", color = muted)
        } else Step {
            Spinner(size = 14.dp, color = muted)
            Text("Loading steps", color = muted)
        }
    }
}
