package dev.relay.android.features.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import dev.relay.android.features.applock.AppLock
import dev.relay.android.features.applock.Biometrics
import dev.relay.android.features.applock.LockAfter
import dev.relay.android.features.applock.PinFlow
import dev.relay.android.features.applock.PinFlowKind
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Switch

/** Settings' lock rows: on or off, the fingerprint, when it locks again, and changing the PIN. */
@Composable
fun LockSection(lock: AppLock) {
    val context = LocalContext.current
    val settings by lock.settings.collectAsState()
    var flow by remember { mutableStateOf<PinFlowKind?>(null) }
    var picking by remember { mutableStateOf(false) }
    val biometrics = remember { Biometrics.available(context) }

    SectionHeader("App lock")
    ListGroup {
        val toggle = { flow = if (settings.on) PinFlowKind.TurnOff else PinFlowKind.TurnOn }
        ListRow(
            "Lock Relay",
            subtitle = "Ask for a PIN when Relay opens. One lock for every computer paired here.",
            subtitleLines = 3,
            trailing = { Switch(settings.on, { toggle() }) },
            onClick = toggle,
        )
        if (settings.on) {
            if (biometrics) ListRow(
                Biometrics.label(context),
                subtitle = "Unlock without typing the PIN.",
                trailing = { Switch(settings.biometrics, lock::useBiometrics) },
                onClick = { lock.useBiometrics(!settings.biometrics) },
            )
            ListRow(
                "Lock when away",
                subtitle = settings.after.label,
                chevron = true,
                onClick = { picking = true },
            )
            ListRow(
                "Change PIN",
                chevron = true,
                onClick = { flow = PinFlowKind.Change },
            )
        }
    }

    flow?.let { PinFlow(it, lock) { flow = null } }
    if (picking) Sheet({ picking = false }, title = "Lock when away", description = "How long Relay can be in the background before it asks again.") {
        ListGroup {
            LockAfter.entries.forEach { after ->
                ChoiceRow(after.label, null, settings.after == after) {
                    lock.lockAfter(after)
                    picking = false
                }
            }
        }
    }
}
