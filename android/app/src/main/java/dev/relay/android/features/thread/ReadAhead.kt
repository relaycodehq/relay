package dev.relay.android.features.thread

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.delta.MissingMessage
import dev.relay.android.remote.model.RemoteChat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.withContext

/**
 * Saves the latest threads for reading offline before they're opened
 * (mobile/src/remote/offline-copies.ts), so a train or a sleeping computer
 * leaves more than the threads read on the phone.
 */
class ReadAhead(
    private val cache: ThreadCache,
    /** The threads to keep copies of; empty while there's no link. */
    private val wanted: Flow<List<Wanted>>,
    private val fetch: suspend (id: String, saved: RemoteChat?) -> RemoteChat,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    data class Wanted(val computer: String, val id: String, val updated: Long) {
        val key get() = "$computer:$id"
    }

    /** Thread → the summary's `updated` it was saved at, this process. */
    private val copied = HashMap<String, Long>()

    suspend fun run() {
        wanted.distinctUntilChanged().collectLatest { all ->
            val due = all.filter { (copied[it.key] ?: 0) < it.updated }
            if (due.isEmpty()) return@collectLatest
            delay(SETTLE)
            for (thread in due) if (!copy(thread)) return@collectLatest
        }
    }

    /** False when the link or the thread is gone; the next change to the list tries again. */
    private suspend fun copy(thread: Wanted): Boolean = try {
        withContext(io) {
            if (!cache.stale(thread.computer, thread.id, thread.updated)) return@withContext
            // Only what changed travels: the saved copy's messages go as known.
            val saved = cache.now(thread.computer, thread.id)
            val fresh = try {
                fetch(thread.id, saved)
            } catch (_: MissingMessage) {
                fetch(thread.id, null)
            }
            cache.save(thread.computer, thread.id, fresh)
        }
        copied[thread.key] = thread.updated
        true
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        false
    }

    companion object {
        /** Fewer than ThreadCache keeps, so threads read on the phone stay too. */
        const val AHEAD = 8
        /** Quiet time after the list moves, so a burst of changes costs one pass. */
        const val SETTLE = 3_000L

        fun of(remote: Remote, cache: ThreadCache) = ReadAhead(
            cache,
            combine(remote.active, remote.status, remote.overview) { computer, status, overview ->
                if (computer == null || status.state != LinkState.Online || overview == null) emptyList()
                else overview.listed.sortedByDescending { it.updated }.take(AHEAD)
                    // A running one changes by the second; it's saved once it stops.
                    .filter { it.running != true }
                    .map { Wanted(computer, it.id, it.updated) }
            },
            fetch = { id, saved ->
                val client = remote.client.value ?: throw IllegalStateException("No computer")
                client.chat(id, saved, Bridge.REMOTE_HISTORY)
            },
        )
    }
}
