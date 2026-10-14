package dev.relay.android.features.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.NotConnected
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.Unanswered
import dev.relay.android.remote.model.RemoteDiffSource
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.lib.navigation.Route
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Dialog
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import java.text.DateFormat
import java.util.Date

/** The live client, or [NotConnected] when there's none to call. */
suspend fun <T> Remote.call(block: suspend RemoteClient.() -> T): T {
    val client = client.value ?: throw NotConnected("Not connected.")
    return client.block()
}

fun errorText(e: Throwable): String = e.message ?: e.toString()

/** A file's diff, as Route.Diff carries it. */
fun diffRoute(source: RemoteDiffSource) = Route.Diff(RemoteJson.encodeToString(source))

/** Online and the app in front: when a screen should (re)load. */
@Composable
fun rememberLive(remote: Remote): Boolean {
    val status by remote.status.collectAsStateWithLifecycle()
    val inFront by rememberInFront()
    return status.state == LinkState.Online && inFront
}

/** One alert at a time: a message with OK, or a confirm with Cancel and an action. */
data class Ask(
    val title: String,
    val message: String? = null,
    val confirm: String? = null,
    val destructive: Boolean = false,
    val onConfirm: () -> Unit = {},
)

class Asks {
    var current by mutableStateOf<Ask?>(null)
        private set

    fun alert(title: String, message: String? = null) {
        current = Ask(title, message)
    }

    fun confirm(title: String, message: String?, confirm: String, destructive: Boolean = false, onConfirm: () -> Unit) {
        current = Ask(title, message, confirm, destructive, onConfirm)
    }

    /**
     * Says an action failed, unless its request went out and only the answer
     * didn't come back: then [unsure] says it may still happen.
     */
    fun failure(e: Throwable, failed: String, unsure: String? = null) {
        val why = errorText(e)
        if (unsure != null && e is Unanswered) alert(unsure, "$why The request went out, so it may still happen once the computer answers.")
        else alert(failed, why)
    }

    fun dismiss() {
        current = null
    }
}

@Composable
fun AskHost(asks: Asks) {
    val ask = asks.current ?: return
    if (ask.confirm == null) {
        Dialog(asks::dismiss, ask.title, description = ask.message, buttons = { Button("OK", asks::dismiss) })
    } else {
        ConfirmDialog(
            ask.title,
            onConfirm = ask.onConfirm,
            // A confirm that raised another alert keeps that one up.
            onDismiss = { if (asks.current === ask) asks.dismiss() },
            message = ask.message,
            confirmText = ask.confirm,
            destructive = ask.destructive,
        )
    }
}

/** A spinner in the middle of the screen. */
@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Spinner(color = RelayTheme.colors.mutedForeground)
    }
}

/** A load that failed: the reason and "Try again". */
@Composable
fun LoadFailed(error: String, onRetry: suspend () -> Unit, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    var trying by remember { mutableStateOf(false) }
    Box(modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(error, color = RelayTheme.colors.mutedForeground, textAlign = TextAlign.Center)
            Button(
                if (trying) "Trying…" else "Try again",
                {
                    trying = true
                    scope.launch {
                        try {
                            onRetry()
                        } finally {
                            trying = false
                        }
                    }
                },
                variant = ButtonVariant.Outline,
                enabled = !trying,
            )
        }
    }
}

/** A muted line in the middle of a list. */
@Composable
fun EmptyNote(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier.padding(horizontal = 16.dp, vertical = 24.dp),
        color = RelayTheme.colors.mutedForeground,
        textAlign = TextAlign.Center,
    )
}

/** "5m ago", "yesterday", then a date (mobile/src/ui/ThreadRow `ago`). */
fun ago(atMs: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = Math.round((now - atMs) / 60000.0)
    if (minutes < 1) return "just now"
    if (minutes < 60) return "${minutes}m ago"
    val hours = Math.round(minutes / 60.0)
    if (hours < 24) return "${hours}h ago"
    val days = Math.round(hours / 24.0)
    return when {
        days == 1L -> "yesterday"
        days < 7 -> "${days}d ago"
        else -> java.text.SimpleDateFormat("MMM d", java.util.Locale.getDefault()).format(Date(atMs))
    }
}

fun dateTime(atMs: Long): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(atMs))

fun plural(n: Int, one: String, many: String = "${one}s") = "$n ${if (n == 1) one else many}"
