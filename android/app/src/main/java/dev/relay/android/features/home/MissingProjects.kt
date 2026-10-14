package dev.relay.android.features.home

import dev.relay.android.remote.model.RemoteOverview
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * One connection's projects that threads point at but the overview doesn't list yet: batch new
 * ids into one refetch a second later, and never loop on ids the desktop really removed.
 */
class MissingProjects(private val scope: CoroutineScope, private val refresh: suspend () -> Unit) {
    private val asked = mutableSetOf<String>()
    private val pending = mutableSetOf<String>()
    private var timer: Job? = null

    fun observe(overview: RemoteOverview) {
        val known = overview.projects.map { it.id }.toSet()
        var added = false
        for (chat in overview.chats) {
            val id = chat.projectId
            if (id in known || id in asked || id in pending) continue
            pending.add(id)
            added = true
        }
        if (!added) return
        timer?.cancel()
        timer = scope.launch {
            delay(1_000)
            val ids = pending.toList()
            pending.clear()
            asked.addAll(ids)
            try {
                refresh()
            } catch (_: Exception) {
                // A failed request hasn't checked these ids; retry on the next push.
                asked.removeAll(ids.toSet())
            }
        }
    }

    fun stop() {
        timer?.cancel()
        pending.clear()
    }
}
