package dev.relay.android.features.subagents

// Chat events don't cover the SDK's background task frames between turns, so
// the phone asks: conditional reads that send nothing unchanged, starting at
// 5s and backing off to 20s (60s after failures). Only the screen in front asks.

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.relay.android.features.thread.desktop
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.subagentRun
import dev.relay.android.remote.client.subagents
import dev.relay.android.remote.model.SubagentRun
import dev.relay.android.ui.rememberInFront
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The next wait after a read: back to 5s on news, doubling to 20s without, to 60s after failures. */
internal fun nextDelay(delay: Long, changed: Boolean?): Long = when (changed) {
    true -> 5_000
    false -> minOf(delay * 2, 20_000)
    null -> minOf(delay * 2, 60_000)
}

/** Conditional reads, one at a time even across loops and manual refreshes. */
@Stable
class Asking(private val ask: suspend () -> Boolean) {
    private val lock = Mutex()
    var error by mutableStateOf<String?>(null)
        private set

    suspend fun request(): Boolean = lock.withLock {
        try {
            ask().also { error = null }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: e.toString()
            throw e
        }
    }

    /** Reads now, keeping a failure in [error] rather than throwing it. */
    suspend fun refresh(): Boolean = try {
        request()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        false
    }
}

@Composable
private fun Poll(remote: Remote, asking: Asking, again: Boolean, enabled: Boolean, nudge: Any?) {
    val online = remote.status.collectAsState().value.state == LinkState.Online
    val inFront by rememberInFront()
    LaunchedEffect(asking, again, enabled, online, inFront, nudge) {
        if (!enabled || !online || !inFront) return@LaunchedEffect
        var wait = 5_000L
        while (true) {
            wait = nextDelay(wait, try {
                asking.request()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            })
            if (!again) break
            delay(wait)
        }
    }
}

@Composable
fun subagentsSupported(remote: Remote): Boolean =
    (remote.overview.collectAsState().value?.bridge ?: 1) >= Bridge.SUBAGENTS

@Stable
class Subagents(private val remote: Remote, private val chatId: String, val asking: Asking) {
    var runs by mutableStateOf<List<SubagentRun>>(emptyList())
        internal set
    val error get() = asking.error

    suspend fun refresh() = asking.refresh()

    suspend fun stop(agentId: String) {
        try {
            remote.desktop("stopProjectChatAgent", chatId, agentId)
        } finally {
            refresh()
        }
    }
}

/** The thread's subagents, kept current while its turn runs or any is still out. */
@Composable
fun rememberSubagents(remote: Remote, chatId: String, enabled: Boolean, running: Boolean, pending: Int): Subagents {
    val client = remote.client.collectAsState().value
    val supported = subagentsSupported(remote)
    val state = remember(client, chatId) {
        var signature: String? = null
        lateinit var made: Subagents
        made = Subagents(remote, chatId, Asking {
            val next = (client ?: return@Asking false).subagents(chatId, signature) ?: return@Asking false
            signature = next.signature
            made.runs = next.runs
            true
        })
        made
    }
    val out = state.runs.any { it.status == "running" }
    // Look again as a turn starts and ends, even when it finishes between reads.
    Poll(remote, state.asking, running || pending > 0 || out, enabled && supported && client != null, "$running:$pending")
    return state
}

@Stable
class SubagentRunState(private val remote: Remote, private val chatId: String, private val agentId: String, client: RemoteClient?) {
    /** False until the first read answers. */
    var loaded by mutableStateOf(false)
        private set
    /** Null once loaded means the session that ran it is gone. */
    var run by mutableStateOf<SubagentRun?>(null)
        private set
    private var signature: String? = null
    val asking = Asking {
        val next = (client ?: return@Asking false).subagentRun(chatId, agentId, signature) ?: return@Asking false
        signature = next.signature
        run = next.run
        loaded = true
        true
    }

    suspend fun stop() {
        try {
            remote.desktop("stopProjectChatAgent", chatId, agentId)
        } finally {
            asking.refresh()
        }
    }
}

/** One agent's run, kept current while it works. */
@Composable
fun rememberSubagentRun(remote: Remote, chatId: String, agentId: String): SubagentRunState {
    val client = remote.client.collectAsState().value
    val state = remember(client, chatId, agentId) { SubagentRunState(remote, chatId, agentId, client) }
    Poll(
        remote, state.asking,
        again = !state.loaded || state.run?.status == "running",
        enabled = subagentsSupported(remote) && client != null,
        nudge = null,
    )
    return state
}
