package dev.relay.android.features.thread

import dev.relay.android.features.thread.logic.applyMessage
import dev.relay.android.features.thread.logic.keepNewer
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.delta.MissingMessage
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.outbox.stamp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * A thread kept current from the desktop's events, refetched when its state
 * moves (mobile/src/remote/useThread.ts). Opens on the offline copy; loads on
 * every reconnect; message events patch it in place, and a finished one, or a
 * change in the thread's summary, fetches it again.
 */
class ThreadModel(
    private val remote: Remote,
    val id: String,
    private val cache: ThreadCache,
) {
    private val computer = remote.active.value
    private val _thread = MutableStateFlow(cache.now(computer, id))
    val thread: StateFlow<RemoteChat?> = _thread.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _history = MutableStateFlow(Bridge.REMOTE_HISTORY)
    /** How many of the latest messages to hold; "Load earlier" asks for a page more. */
    val history: StateFlow<Int> = _history.asStateFlow()
    val canLoadEarlier get() = _history.value < Bridge.MAX_REMOTE_HISTORY
    private val _loadedHistory = MutableStateFlow(0)
    val loadedHistory: StateFlow<Int> = _loadedHistory.asStateFlow()
    private val _fetched = MutableStateFlow(0L)
    /** The outbox [stamp] taken as the latest fetch went out, for telling which sends it covers. */
    val fetched: StateFlow<Long> = _fetched.asStateFlow()

    // One fetch at a time; asked during one, it runs once more after it.
    private val fetching = Mutex()
    @Volatile private var again = false

    val summary get() = summaryOf(remote.overview.value)
    fun summaryOf(overview: dev.relay.android.remote.model.RemoteOverview?): RemoteChatSummary? =
        overview?.chats?.find { it.id == id }

    suspend fun load() {
        again = true
        if (fetching.isLocked) return
        fetching.withLock {
            while (again) {
                again = false
                fetchOnce()
            }
        }
        // Asked between the last check and the unlock.
        if (again) load()
    }

    private suspend fun fetchOnce() {
        val client = remote.client.value ?: return
        try {
            val history = _history.value
            val started = stamp()
            val asked = _thread.value
            val next = try {
                client.chat(id, asked, history)
            } catch (_: MissingMessage) {
                client.chat(id, null, history)
            }
            _thread.value = keepNewer(next, _thread.value, asked)
            _fetched.value = started
            _loadedHistory.value = history
            cache.save(computer, id, next)
            _error.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _error.value = e.message ?: e.toString()
        }
    }

    fun loadEarlier() {
        _history.value = minOf(Bridge.MAX_REMOTE_HISTORY, _history.value + Bridge.REMOTE_HISTORY)
    }

    /** Keeps it current while [scope] lives: the screen's lifetime. */
    fun run(scope: CoroutineScope) {
        scope.launch {
            remote.status.map { it.state == LinkState.Online }.distinctUntilChanged().collect { online ->
                if (online) load()
            }
        }
        scope.launch {
            remote.messages(id).collect { event ->
                _thread.value?.let { _thread.value = applyMessage(it, event.message) }
                if (event.message.status != "streaming") launch { load() }
            }
        }
        // Running, waiting, queue and worktree changes arrive as thread summaries.
        scope.launch {
            remote.overview.map { o ->
                summaryOf(o)?.let { "${it.running}:${it.waiting}:${it.updated}:${it.title}:${it.queueMark}:${it.branch}:${it.worktree}" } ?: ""
            }.distinctUntilChanged().collect { signature ->
                if (signature.isNotEmpty() && _thread.value != null) launch { load() }
            }
        }
        scope.launch { _history.drop(1).collect { load() } }
    }
}
