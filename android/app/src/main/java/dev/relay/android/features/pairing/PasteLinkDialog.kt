package dev.relay.android.features.pairing

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import dev.relay.android.remote.PairingLink
import dev.relay.android.remote.parsePairingUrl
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Dialog
import dev.relay.android.ui.TextField

/** ios PairingView's "Pairing link" alert: for when the clipboard holds something else. */
@Composable
fun PasteLinkDialog(onPair: (PairingLink) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    fun take() {
        val parsed = parsePairingUrl(text.trim())
        if (parsed == null) {
            error = "That isn't a Relay pairing link."
            return
        }
        onDismiss()
        onPair(parsed)
    }
    Dialog(
        onDismiss,
        "Pairing link",
        description = "Copy the link under the code in Relay's Settings → Phone.",
        buttons = {
            Button("Cancel", onDismiss, variant = ButtonVariant.Outline)
            Button("Pair", ::take, enabled = text.isNotBlank())
        },
    ) {
        TextField(
            text,
            {
                text = it
                error = null
            },
            Modifier.fillMaxWidth(),
            placeholder = "relay-remote://pair?…",
            error = error,
            mono = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { take() }),
            focusRequester = focus,
        )
    }
}
