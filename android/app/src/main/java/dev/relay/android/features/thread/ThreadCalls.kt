package dev.relay.android.features.thread

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.NotConnected
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.Unanswered
import dev.relay.android.ui.Button
import dev.relay.android.ui.Dialog
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.coroutines.CancellationException

/** A Kotlin value as a bridge argument: strings, numbers, booleans, lists, maps and JSON as they are. */
fun jsonOf(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is List<*> -> JsonArray(value.map(::jsonOf))
    is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to jsonOf(v) })
    else -> error("Not a bridge value: ${value::class}")
}

fun Remote.connected(): RemoteClient = client.value ?: throw NotConnected("Not connected to your computer.")

/** One of the desktop's own calls, as `remote.desktop(method, ...args)` makes it. */
suspend fun Remote.desktop(method: String, vararg args: Any?): JsonElement =
    connected().desktop(method, args.map(::jsonOf))

/** What went wrong, as a modal says it. */
data class Failure(val title: String, val message: String)

class FailureState {
    var shown by mutableStateOf<Failure?>(null)

    fun show(title: String, message: String) {
        shown = Failure(title, message)
    }

    /**
     * Says an action failed, unless its request went out and only the answer
     * didn't come back: the computer may still do it, so [unsure] says that.
     */
    fun alert(e: Throwable, failed: String, unsure: String? = null) {
        val why = e.message ?: e.toString()
        if (unsure != null && e is Unanswered)
            show(unsure, "$why The request went out, so it may still happen once the computer answers.")
        else show(failed, why)
    }
}

@Composable
fun rememberFailures() = remember { FailureState() }

@Composable
fun FailureDialog(state: FailureState) {
    val failure = state.shown ?: return
    Dialog(
        onDismiss = { state.shown = null },
        title = failure.title,
        description = failure.message,
        buttons = { Button("OK", onClick = { state.shown = null }) },
    )
}

/** Runs [job], rethrowing cancellation and handing every other failure to [onError]. */
suspend inline fun attempt(onError: (Throwable) -> Unit, job: () -> Unit) {
    try {
        job()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        onError(e)
    }
}

fun copyText(context: android.content.Context, text: String) {
    val board = context.getSystemService(android.content.ClipboardManager::class.java) ?: return
    board.setPrimaryClip(android.content.ClipData.newPlainText("Relay", text))
}

/** The paired computer's name, as the thread's notes say it. */
@Composable
fun computerName(remote: Remote?): String {
    val overview = remote?.overview?.collectAsState()?.value
    return overview?.name ?: "your computer"
}
