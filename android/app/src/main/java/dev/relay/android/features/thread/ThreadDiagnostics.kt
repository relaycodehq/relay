package dev.relay.android.features.thread

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import dev.relay.android.features.diagnostics.ScrollDiagnostics
import dev.relay.android.features.diagnostics.ThreadLogState
import dev.relay.android.features.diagnostics.ThreadMeasurements
import dev.relay.android.remote.model.ChatMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.conflate

@Composable
internal fun rememberThreadMeasurements(id: String, root: String?, computer: String?): ThreadMeasurements {
    val context = LocalContext.current
    val measurements = remember(id, root, computer) {
        ThreadMeasurements(ScrollDiagnostics.of(context).trace(id, computer, root))
    }
    val trace = measurements.trace
    val density = LocalDensity.current
    val configuration = LocalConfiguration.current
    val ime = WindowInsets.ime
    DisposableEffect(trace) {
        trace.event("screen_open")
        onDispose { trace.event("screen_close") }
    }
    LaunchedEffect(trace, density.density, density.fontScale, configuration.screenWidthDp, configuration.screenHeightDp) {
        trace.event("configuration", "density" to density.density, "fontScale" to density.fontScale,
            "screenWidthDp" to configuration.screenWidthDp, "screenHeightDp" to configuration.screenHeightDp)
    }
    LaunchedEffect(trace, density, ime) {
        snapshotFlow { ime.getBottom(density) }.collect { trace.event("ime", "bottomPx" to it) }
    }
    return measurements
}

@Composable
internal fun ObserveThreadMeasurements(
    measurements: ThreadMeasurements,
    all: List<ChatMessage>,
    listed: List<ChatMessage>,
    rows: List<ThreadMessageRow>,
    earlier: Int?,
    running: Boolean,
    inFront: Boolean,
    locked: Boolean,
) {
    LaunchedEffect(measurements, rows, earlier) {
        measurements.rows(buildList {
            if (earlier != null) add("earlier" to null)
            rows.forEach { add(it.key to it.message.id) }
            add("end" to null)
        })
    }
    val currentAll by rememberUpdatedState(all)
    val currentListed by rememberUpdatedState(listed)
    val currentEarlier by rememberUpdatedState(earlier)
    val currentRunning by rememberUpdatedState(running)
    LaunchedEffect(measurements) {
        snapshotFlow { ThreadLogState(currentAll, currentListed, currentEarlier, currentRunning) }.conflate().collect { state ->
            measurements.messages(state.all, state.listed, state.earlier, state.running)
            delay(250)
        }
    }
    LaunchedEffect(measurements, inFront, locked) {
        measurements.trace.event("visibility", "inFront" to inFront, "locked" to locked)
        if (inFront && !locked) {
            measurements.messages(currentAll, currentListed, currentEarlier, currentRunning, full = true)
            while (true) {
                delay(60_000)
                measurements.messages(currentAll, currentListed, currentEarlier, currentRunning, full = true)
            }
        }
    }
}
