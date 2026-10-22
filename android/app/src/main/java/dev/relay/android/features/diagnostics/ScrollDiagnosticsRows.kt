package dev.relay.android.features.diagnostics

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Tone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ScrollDiagnosticsRows() {
    val context = LocalContext.current
    val recorder = remember { ScrollDiagnostics.of(context) }
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    var preparing by remember { mutableStateOf(false) }
    // Snapshot before the document picker opens; scrolling the picker cannot rotate it away.
    var snapshotPath by rememberSaveable { mutableStateOf<String?>(null) }
    val busy = preparing || snapshotPath != null
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        val file = snapshotPath?.let(::File)
        if (uri != null && file != null) scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
                        ?: error("Couldn't open the selected file")
                }
                toasts.show("Scroll logs saved")
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                toasts.show("Couldn't save scroll logs", e.message, tone = Tone.Destructive)
            } finally { snapshotPath = null }
        } else { snapshotPath = null }
    }
    ListRow(
        "Save scroll logs",
        subtitle = if (busy) "Preparing or saving…" else "Layouts and scroll decisions, no message text. Up to 18 MiB, kept across restarts.",
        subtitleLines = 3,
        onClick = {
            if (!busy) {
                preparing = true
                scope.launch {
                    try {
                        snapshotPath = recorder.export().absolutePath
                        val date = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
                        save.launch("relay-scroll-$date.zip")
                    } catch (e: Exception) {
                        if (e is CancellationException) throw e
                        snapshotPath = null
                        toasts.show("Couldn't prepare scroll logs", e.message, tone = Tone.Destructive)
                    } finally { preparing = false }
                }
            }
        },
    )
    ListRow(
        "Keep scroll incident",
        subtitle = "Keep recent history after a jump. The last 3 marked incidents are protected from automatic rotation.",
        subtitleLines = 3,
        onClick = { scope.launch {
            try { recorder.keepIncident(); toasts.show("Scroll incident kept", "Included when you save scroll logs.") }
            catch (e: Exception) { toasts.show("Couldn't keep scroll incident", e.message, tone = Tone.Destructive) }
        } },
    )
}
