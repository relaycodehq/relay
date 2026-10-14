package dev.relay.android.features.thread

// What the phone holds of each thread a lead started, for the lead's rows
// (mobile/src/remote/started-peeks.ts): its latest answer and what it asks.
// From the saved copy first, one fetch whenever it starts, stops or asks, and
// the desktop's message events in between.

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import dev.relay.android.features.thread.logic.applyMessage
import dev.relay.android.features.thread.logic.mainMessages
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.delta.MissingMessage
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteChatSummary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

data class Peek(val answer: ChatMessage? = null, val request: String? = null)

/** An agent's own answer, not a note Relay writes into the thread. */
private fun isAnswer(m: ChatMessage) =
    m.role == "assistant" && m.compaction != true && m.handoff == null && m.reload == null && m.worktreeCommand == null

private fun peekOf(thread: RemoteChat): Peek {
    val request = thread.requests?.firstOrNull()
    return Peek(
        answer = mainMessages(thread.messages).lastOrNull(::isAnswer),
        request = request?.let { it.questions?.firstOrNull()?.question ?: it.title },
    )
}

private fun newerAnswer(held: ChatMessage?, incoming: ChatMessage?) =
    held != null && (incoming == null || held.created > incoming.created || (held.id == incoming.id && held.version > incoming.version))

private object Peeks {
    val all = MutableStateFlow<Map<String, Peek>>(emptyMap())
    /** The started thread's running/waiting state its peek was last fetched at. */
    val fetchedAt = ConcurrentHashMap<String, String>()

    fun set(key: String, peek: Peek) = all.update { it + (key to peek) }
}

/** Each started thread's peek, kept current while the rows that show them are up. */
@Composable
fun rememberStartedPeeks(remote: Remote, started: List<RemoteChatSummary>): (String) -> Peek {
    val cache = ThreadCache.of(LocalContext.current)
    val computer = remote.active.collectAsState().value ?: ""
    val online = remote.status.collectAsState().value.state == LinkState.Online
    val ids = started.map { it.id }
    LaunchedEffect(ids, computer) {
        coroutineScope {
            for (id in ids) launch {
                remote.messages(id).collect { event ->
                    val message = event.message
                    if (message.parentId != null || !isAnswer(message)) return@collect
                    val key = "$computer:$id"
                    val held = Peeks.all.value[key]
                    if (newerAnswer(held?.answer, message)) return@collect
                    Peeks.set(key, (held ?: Peek()).copy(answer = message))
                }
            }
        }
    }
    // Starting, stopping and asking change what the rows say: fetch what changed then.
    val states = started.map { it.id to "${it.running == true}:${it.waiting == true}" }
    LaunchedEffect(states, computer, online) {
        // A thread can answer again while the link is down and still read idle,
        // so the next connection fetches every row once more.
        if (!online) Peeks.fetchedAt.clear()
        coroutineScope {
            for ((id, state) in states) {
                val key = "$computer:$id"
                if (Peeks.fetchedAt[key] == state) continue
                launch { fetch(remote, cache, computer, id, key, state, online) }
            }
        }
    }
    val peeks by Peeks.all.collectAsState()
    return { id -> peeks["$computer:$id"] ?: Peek() }
}

private suspend fun fetch(remote: Remote, cache: ThreadCache, computer: String, id: String, key: String, state: String, online: Boolean) {
    val saved = cache.now(computer, id)
    if (saved != null && key !in Peeks.all.value) Peeks.set(key, peekOf(saved))
    if (!online || Peeks.fetchedAt[key] == state) return
    val client = remote.client.value ?: return
    try {
        val before = Peeks.all.value[key]?.answer
        var thread = try {
            client.chat(id, saved, Bridge.REMOTE_HISTORY)
        } catch (_: MissingMessage) {
            client.chat(id, null, Bridge.REMOTE_HISTORY)
        }
        var peek = peekOf(thread)
        val held = Peeks.all.value[key]?.answer
        // Message events can finish an answer while this fetch still carries
        // its streaming version. Keep that answer in the offline copy too.
        if (held !== before && newerAnswer(held, peek.answer)) {
            thread = applyMessage(thread, held!!)
            peek = peek.copy(answer = held)
        }
        cache.save(computer, id, thread)
        Peeks.set(key, peek)
        Peeks.fetchedAt[key] = state
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        // Lost the link or the thread: the next change or visit asks again.
    }
}
