package dev.relay.android.features.notes

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.relay.android.features.thread.FailureState
import dev.relay.android.features.thread.LocalFailures
import dev.relay.android.features.thread.desktop
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.ThreadNote
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement

/** The notes each thread showed last, by computer and thread, with the mark they were fetched at. */
private val kept = object : LinkedHashMap<String, Pair<String?, List<ThreadNote>>>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<String?, List<ThreadNote>>>) = size > 32
}

private fun decode(value: JsonElement): List<ThreadNote> = RemoteJson.decodeFromJsonElement(value)

/**
 * A thread's notes (src/features/notes/useThreadNotes.ts): fetched again
 * whenever its summary's `notesMark` moves, so one an agent keeps shows up
 * without asking. Ticks and removals show at once and settle on what the
 * computer answers.
 */
@Stable
class ThreadNotes internal constructor(
    private val remote: Remote,
    private val chatId: String,
    private val key: String,
    private val scope: CoroutineScope,
    private val failures: FailureState,
) {
    var notes by mutableStateOf(kept[key]?.second.orEmpty())
        private set

    private fun settle(next: List<ThreadNote>) {
        notes = next
        kept[key] = notesMark(next) to next
    }

    /** The computer's copy; null when it can't be asked, and the next move of the mark asks again. */
    private suspend fun fetch(): List<ThreadNote>? = try {
        decode(remote.desktop("threadNotes", chatId))
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    internal suspend fun follow(mark: String?, online: Boolean) {
        if (mark == null) return settle(emptyList())
        if (kept[key]?.first == mark || !online) return
        fetch()?.let(::settle)
    }

    /** Ticks item [index] (from 0) of a list note, or unticks it. */
    fun tick(note: ThreadNote, index: Int, done: Boolean) =
        change({ ticked(it, note.id, index, done) }, "Couldn't tick it") {
            remote.desktop("tickThreadNote", chatId, note.id, index + 1, done)
        }

    fun remove(note: ThreadNote) =
        change({ list -> list.filter { it.id != note.id } }, "Couldn't remove it") {
            remote.desktop("removeThreadNote", chatId, note.id)
        }

    private fun change(here: (List<ThreadNote>) -> List<ThreadNote>, failed: String, save: suspend () -> JsonElement) {
        val before = notes
        notes = here(before)
        scope.launch {
            try {
                settle(decode(save()))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failures.alert(e, failed)
                fetch()?.let(::settle) ?: run { notes = before }
            }
        }
    }
}

/** The thread's notes, or null while its computer can't share them (before Bridge.NOTES). */
@Composable
fun rememberThreadNotes(remote: Remote, chatId: String, mark: String?): ThreadNotes? {
    val bridge = remote.overview.collectAsState().value?.bridge ?: 1
    val online = remote.status.collectAsState().value.state == LinkState.Online
    val computer by remote.active.collectAsState()
    val scope = rememberCoroutineScope()
    val failures = LocalFailures.current
    val notes = remember(computer, chatId) { ThreadNotes(remote, chatId, "$computer|$chatId", scope, failures) }
    val shared = bridge >= Bridge.NOTES
    LaunchedEffect(notes, mark, online, shared) { if (shared) notes.follow(mark, online) }
    return notes.takeIf { shared }
}
