package dev.relay.android.features.pulls

import androidx.lifecycle.ViewModel
import dev.relay.android.features.git.call
import dev.relay.android.features.git.ciSummary
import dev.relay.android.features.git.errorText
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.hostAccount
import dev.relay.android.remote.client.pull
import dev.relay.android.remote.client.pullCiStatus
import dev.relay.android.remote.client.pullReviews
import dev.relay.android.remote.client.pullServers
import dev.relay.android.remote.client.searchPulls
import dev.relay.android.remote.model.IssueHit
import dev.relay.android.remote.model.PullRef
import dev.relay.android.remote.model.PullReview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

/** Why a PR is on your list, the strongest first: one it asks you to review outranks your own. */
enum class Relation { Review, Assigned, Mine }

data class ListedPull(val hit: IssueHit, val server: String, val relation: Relation) {
    val ref = PullRef(hit.repository.owner, hit.repository.name, hit.number, hit.repository.server ?: server)
    val key = pullKey(ref)
    val updated = isoMs(hit.updated_at)
    val merged = hit.pull_request?.merged == true
}

/** What your own open PR is waiting on: CI's state and the reviewers' verdict. */
data class PullSignals(val ci: String?, val verdict: String?)

fun pullKey(r: PullRef) = "${r.server.orEmpty().trimEnd('/').lowercase()}|${r.owner}/${r.name}#${r.number}".lowercase()

fun isoMs(iso: String): Long = runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

/**
 * The reviewers' standing verdict, as the desktop's board reads it: anyone's latest change
 * request wins, then a fresh approval (src/features/pulls/pull-board.ts `verdictOf`).
 */
fun verdictOf(reviews: List<PullReview>): String? {
    val latest = reviews.filter { (it.state == "APPROVED" || it.state == "REQUEST_CHANGES") && it.dismissed != true }
        .groupBy { if (it.user.id != 0L) "${it.user.id}" else it.user.login }
        .map { (_, theirs) -> theirs.maxWith(compareBy({ isoMs(it.submitted_at) }, { it.id })) }
    return when {
        latest.any { it.state == "REQUEST_CHANGES" } -> "changes"
        latest.any { it.state == "APPROVED" && it.stale != true } -> "approved"
        else -> null
    }
}

private val FILTERS = listOf("review_requested" to Relation.Review, "assigned" to Relation.Assigned, "created" to Relation.Mine)

/** Merges each host's three searches into one list, a PR once under its strongest relation. */
fun mergeSearches(found: List<Triple<String, Relation, List<IssueHit>>>): List<ListedPull> {
    val byKey = LinkedHashMap<String, ListedPull>()
    for ((server, relation, hits) in found) for (hit in hits) {
        if (hit.pull_request == null) continue
        val next = ListedPull(hit, server, relation)
        val known = byKey[next.key]
        if (known == null || relation.ordinal < known.relation.ordinal) byKey[next.key] = next
    }
    return byKey.values.sortedByDescending { it.updated }
}

/** The host as people know it, for "Waiting for Gitea…". */
fun hostName(server: String): String {
    val host = runCatching { java.net.URI(server).host.orEmpty() }.getOrDefault("").lowercase()
    return when {
        host == "github.com" -> "GitHub"
        host == "dev.azure.com" || host.endsWith(".visualstudio.com") -> "Azure DevOps"
        else -> "Gitea"
    }
}

/**
 * Every host's searches run at once and each lands on the list as it answers, so a slow
 * Gitea doesn't hold back what GitHub already found.
 */
class PullsModel(private val remote: Remote) : ViewModel() {
    /** Each search's hits by "server|filter"; a refresh replaces them one by one, so the list stays put. */
    private val found = MutableStateFlow<Map<String, Triple<String, Relation, List<IssueHit>>>>(emptyMap())
    val pulls = MutableStateFlow<List<ListedPull>?>(null)
    /** Hosts still searching. */
    val pending = MutableStateFlow<Set<String>>(emptySet())
    /** Hosts whose search failed, with why. */
    val failed = MutableStateFlow<Map<String, String>>(emptyMap())
    /** Couldn't even ask which hosts there are. */
    val error = MutableStateFlow<String?>(null)
    /** No host is signed in on the computer. */
    val signedOut = MutableStateFlow(false)
    val signals = MutableStateFlow<Map<String, PullSignals>>(emptyMap())
    /** "open" | "closed" | "all", as the hosts' searches take it. */
    val state = MutableStateFlow("open")

    /** Another state is a list of its own: what the last one found goes, and it searches afresh. */
    suspend fun show(next: String) {
        if (next == state.value) return
        state.value = next
        found.value = emptyMap()
        pulls.value = null
        failed.value = emptyMap()
        load()
    }

    suspend fun load() {
        val state = state.value
        val servers = try {
            remote.call { pullServers() }
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
            return
        }
        error.value = null
        pending.value = servers.toSet()
        var signedIn = 0
        coroutineScope {
            for (server in servers) launch {
                try {
                    if (remote.call { hostAccount(server) } == null) {
                        found.update { all -> all.filterKeys { !it.startsWith("$server|") } }
                        return@launch
                    }
                    signedIn++
                    coroutineScope {
                        for ((filter, relation) in FILTERS) launch {
                            val hits = remote.call { searchPulls(filter, state, server) }.items
                            // A switch while this searched leaves its answer out of the new state's list.
                            if (state != this@PullsModel.state.value) return@launch
                            found.update { it + ("$server|$filter" to Triple(server, relation, hits)) }
                            publish()
                            if (relation == Relation.Mine && state != "closed") launch { loadSignals(pulls.value.orEmpty().filter { it.server == server && it.relation == Relation.Mine && it.hit.state == "open" }.take(MAX_SIGNALS)) }
                        }
                    }
                    failed.update { it - server }
                } catch (e: Throwable) {
                    if (e is CancellationException) throw e
                    failed.update { it + (server to errorText(e)) }
                } finally {
                    pending.update { it - server }
                    publish()
                }
            }
        }
        signedOut.value = signedIn == 0 && failed.value.isEmpty()
    }

    private fun publish() {
        pulls.value = mergeSearches(found.value.values.toList())
    }

    /** Your own PRs' CI and verdict: a search hit has neither, so each costs its own calls. */
    private suspend fun loadSignals(mine: List<ListedPull>) = coroutineScope {
        for (p in mine) launch {
            runCatching {
                val detail = remote.call { pull(p.ref) }
                val ci = async { runCatching { remote.call { pullCiStatus(p.ref, detail.head.ref) } }.getOrNull() }
                val reviews = runCatching { remote.call { pullReviews(p.ref) }.items }.getOrDefault(emptyList())
                val state = ci.await()?.let { ciSummary(it.runs)?.state }
                signals.update { it + (p.key to PullSignals(state, verdictOf(reviews))) }
            }.onFailure { if (it is CancellationException) throw it }
        }
    }

    private companion object {
        const val MAX_SIGNALS = 12
    }
}
