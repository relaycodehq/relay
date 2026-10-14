package dev.relay.android.features.newthread

import dev.relay.android.features.composer.logic.NewThreadModels
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.remote.model.ResumeSettings
import java.util.concurrent.ConcurrentHashMap

// mobile/src/remote/new-thread.ts.

/** A project's id, or [SCRATCH] for a Scratchpad chat in whichever folder the desktop hands out. */
typealias Where = String

const val SCRATCH = "scratch"

data class Asked(val project: String? = null, val scratch: Boolean = false)

/** The projects a new thread can start in, the one used last first. */
fun projectsByUse(projects: List<RemoteProject>, chats: List<RemoteChatSummary>): List<RemoteProject> {
    val order = HashMap<String, Int>()
    chats.forEachIndexed { i, c -> order.putIfAbsent(c.projectId, i) }
    return projects.filter { it.scratch != true }
        .withIndex()
        .sortedWith(compareBy({ order[it.value.id] ?: Int.MAX_VALUE }, { it.index }))
        .map { it.value }
}

/** Where a new thread starts: what the screen was opened for, else where the latest thread is. */
fun startingWhere(overview: RemoteOverview?, asked: Asked): Where? {
    if (asked.scratch) return SCRATCH
    if (overview == null) return null
    fun of(id: String?) = overview.projects.find { it.id == id }
    // From a Scratchpad thread, /new means another Scratchpad chat, not that folder.
    val wanted = of(asked.project) ?: of(overview.chats.firstOrNull()?.projectId)
    if (wanted != null) return if (wanted.scratch == true) SCRATCH else wanted.id
    return overview.projects.find { it.scratch != true }?.id ?: SCRATCH
}

/** Holds a valid choice as threads move, but recovers when the live list removes its project. */
fun availableWhere(picked: Where?, overview: RemoteOverview?, asked: Asked): Where? {
    if (picked == SCRATCH || (picked != null && (overview == null || overview.projects.any { it.id == picked }))) return picked
    return startingWhere(overview, asked)
}

/** shared/chat-activity chatSettled. */
fun chatSettled(chat: RemoteChatSummary): Boolean {
    val settled = chat.settledAt ?: return false
    if (chat.waiting == true) return false
    if (chat.settleWhenDone != null) return true
    return chat.running != true && settled >= chat.updated
}

/** What the last new thread opened on, per computer, until the computer answers again; ComposerSaves keeps it across launches. */
internal object LastNewThread {
    private val saved = ConcurrentHashMap<String, Pair<ResumeSettings, NewThreadModels>>()
    fun of(computer: String?) = computer?.let { saved[it] }
    fun save(computer: String?, settings: ResumeSettings, models: NewThreadModels) {
        if (computer != null) saved[computer] = settings to models
    }
}
