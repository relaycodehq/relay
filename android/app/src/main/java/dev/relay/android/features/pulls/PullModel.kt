package dev.relay.android.features.pulls

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.relay.android.features.git.Asks
import dev.relay.android.features.git.call
import dev.relay.android.features.git.errorText
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.commentOnPull
import dev.relay.android.remote.client.mergePull
import dev.relay.android.remote.client.pull
import dev.relay.android.remote.client.pullCiStatus
import dev.relay.android.remote.client.pullDiscussion
import dev.relay.android.remote.client.pullFiles
import dev.relay.android.remote.client.pullMergeReadiness
import dev.relay.android.remote.client.pullReviews
import dev.relay.android.remote.client.reviewPull
import dev.relay.android.remote.model.CiStatus
import dev.relay.android.remote.model.MergeReadiness
import dev.relay.android.remote.model.PullComment
import dev.relay.android.remote.model.PullDetail
import dev.relay.android.remote.model.PullFile
import dev.relay.android.remote.model.PullRef
import dev.relay.android.remote.model.PullReview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Everything the PR screen shows, read in one go after the PR itself. */
data class PullPage(
    val pull: PullDetail,
    val ci: CiStatus?,
    val reviews: List<PullReview>,
    val files: List<PullFile>,
    /** More files than the first page holds. */
    val moreFiles: Boolean,
    val comments: List<PullComment>,
    /** Null for a PR that's done, or when the host couldn't say. */
    val readiness: MergeReadiness?,
    /** The computer is new enough to merge from here (bridge [Bridge.MERGE]). */
    val merges: Boolean,
)

class PullModel(private val remote: Remote, val ref: PullRef) : ViewModel() {
    val page = MutableStateFlow<PullPage?>(null)
    val error = MutableStateFlow<String?>(null)
    /** "approve" | "comment" | "changes" | "agent" | "merge" while that goes. */
    val busy = MutableStateFlow<String?>(null)
    val asks = Asks()

    private var recheck: Job? = null

    suspend fun load() {
        recheck?.cancel()
        try {
            val pull = remote.call { pull(ref) }
            val merges = remote.client.value?.supports(Bridge.MERGE) == true
            page.value = coroutineScope {
                val ci = async { runCatching { remote.call { pullCiStatus(ref, pull.head.ref) } }.getOrNull() }
                val reviews = async { runCatching { remote.call { pullReviews(ref) }.items }.getOrDefault(emptyList()) }
                val files = async { runCatching { remote.call { pullFiles(ref) } }.getOrNull() }
                val comments = async { runCatching { remote.call { pullDiscussion(ref) }.items }.getOrDefault(emptyList()) }
                val readiness = async {
                    if (pull.state != "open" || pull.merged || !merges) null
                    else runCatching { remote.call { pullMergeReadiness(ref) } }.getOrNull()
                }
                val f = files.await()
                PullPage(pull, ci.await(), reviews.await(), f?.items.orEmpty(), f?.nextPage != null, comments.await(), readiness.await(), merges)
            }
            error.value = null
            recheckReadiness()
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
        }
    }

    /** GitHub works out whether a PR merges in the background, so "unknown" is asked about again a few times. */
    private fun recheckReadiness() {
        if (page.value?.readiness?.status != "unknown") return
        recheck = viewModelScope.launch {
            for (wait in listOf(2_000L, 4_000L, 8_000L)) {
                delay(wait)
                val readiness = runCatching { remote.call { pullMergeReadiness(ref) } }.getOrNull() ?: continue
                page.update { it?.copy(readiness = readiness) }
                if (readiness.status != "unknown") return@launch
            }
        }
    }

    /** [reload] after a failure too, for a refusal that means the screen is out of date. */
    private fun run(what: String, failed: String, unsure: String? = null, reload: Boolean = false, job: suspend () -> Unit) {
        busy.value = what
        viewModelScope.launch {
            try {
                job()
                load()
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                asks.failure(e, failed, unsure)
                if (reload) load()
            } finally {
                busy.value = null
            }
        }
    }

    fun comment(body: String) = run("comment", "Couldn't comment") { remote.call { commentOnPull(ref, body) } }

    /** [event] "APPROVED" | "REQUEST_CHANGES", on the head this screen showed. */
    fun review(event: String, body: String) {
        val head = page.value?.pull?.head?.sha ?: return
        run(if (event == "APPROVED") "approve" else "changes", "Couldn't send the review") { remote.call { reviewPull(ref, head, event, body) } }
    }

    fun agent(job: suspend () -> Unit) = run("agent", "Couldn't start the thread", job = job)

    /** [method] "merge" | "squash" | "rebase", only while the PR is still at [head], the one the user confirmed. */
    fun merge(head: String, method: String) {
        run("merge", "Couldn't merge", "The merge may have gone through", reload = true) { remote.call { mergePull(ref, head, method) } }
    }
}
