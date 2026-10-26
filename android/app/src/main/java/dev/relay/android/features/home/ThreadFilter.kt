package dev.relay.android.features.home

import dev.relay.android.features.composer.logic.agentName
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import java.io.File

/** Narrows the thread list to some projects or agents, as the desktop's sidebar filter does. */
@Serializable
data class ThreadFilter(val projects: Set<String> = emptySet(), val agents: Set<String> = emptySet()) {
    val count: Int get() = projects.size + agents.size

    fun keeps(chat: RemoteChatSummary): Boolean =
        (projects.isEmpty() || chat.projectId in projects) && (agents.isEmpty() || (chat.provider ?: "") in agents)

    /** Keeps a new thread's draft only for a picked project; agents don't apply to it. */
    fun keepsDraft(key: String): Boolean = projects.isEmpty() || newDraftProject(key)?.let { it in projects } != false

    /**
     * What's ticked of what's still there: a removed project or an agent no thread ran anymore
     * would otherwise hide every thread.
     */
    fun current(overview: RemoteOverview): ThreadFilter = ThreadFilter(
        projects intersect overview.projects.mapTo(HashSet()) { it.id },
        agents intersect overview.listed.mapNotNullTo(HashSet()) { it.provider },
    )

    fun toggled(kind: Kind, ids: List<String>): ThreadFilter {
        val set = if (kind == Kind.Projects) projects else agents
        val next = if (ids.any { it in set }) set - ids.toSet() else set + ids
        return if (kind == Kind.Projects) copy(projects = next) else copy(agents = next)
    }

    enum class Kind { Projects, Agents }
}

/** A project row in the filter; every computer's Scratchpad is one row standing for all of them. */
data class FilterProject(val project: RemoteProject, val name: String, val ids: List<String>)

data class FilterChoices(val agents: List<String>, val projects: List<FilterProject>)

/**
 * Agents once threads ran more than one, since a single agent filters nothing, sorted by name;
 * projects with the latest activity first.
 */
fun filterChoices(overview: RemoteOverview): FilterChoices {
    val agents = overview.listed.mapNotNull { it.provider }.distinct().sortedBy { agentName(it) }
    val latest = HashMap<String, Long>()
    for (chat in overview.listed) latest.merge(chat.projectId, chat.updated, ::maxOf)
    val sorted = overview.projects.sortedByDescending { latest[it.id] ?: 0L }
    val scratch = sorted.filter { it.scratch == true }.map { it.id }
    val projects = sorted.mapNotNull { p ->
        when {
            p.scratch != true -> FilterProject(p, p.name, listOf(p.id))
            p.id == scratch.first() -> FilterProject(p, "Scratchpad", scratch)
            else -> null
        }
    }
    return FilterChoices(if (agents.size > 1) agents else emptyList(), projects)
}

/** The filter, kept past a restart and across computers, as the iPhone keeps it. */
class ThreadFilterStore(private val file: File) {
    private val _filter = MutableStateFlow(load())
    val filter: StateFlow<ThreadFilter> = _filter.asStateFlow()

    fun set(filter: ThreadFilter) {
        _filter.value = filter
        runCatching { file.writeText(RemoteJson.encodeToString(filter)) }
    }

    private fun load(): ThreadFilter = runCatching<ThreadFilter> {
        if (file.exists()) RemoteJson.decodeFromString(file.readText()) else ThreadFilter()
    }.getOrDefault(ThreadFilter())
}
