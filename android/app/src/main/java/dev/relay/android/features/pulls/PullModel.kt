package dev.relay.android.features.pulls

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.relay.android.features.git.Asks
import dev.relay.android.features.git.call
import dev.relay.android.features.git.errorText
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.commentOnPull
import dev.relay.android.remote.client.pull
import dev.relay.android.remote.client.pullCiStatus
import dev.relay.android.remote.client.pullDiscussion
import dev.relay.android.remote.client.pullFiles
import dev.relay.android.remote.client.pullReviews
import dev.relay.android.remote.client.reviewPull
import dev.relay.android.remote.model.CiStatus
import dev.relay.android.remote.model.PullComment
import dev.relay.android.remote.model.PullDetail
import dev.relay.android.remote.model.PullFile
import dev.relay.android.remote.model.PullRef
import dev.relay.android.remote.model.PullReview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
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
)

class PullModel(private val remote: Remote, val ref: PullRef) : ViewModel() {
    val page = MutableStateFlow<PullPage?>(null)
    val error = MutableStateFlow<String?>(null)
    /** "approve" | "comment" | "changes" | "agent" while that goes. */
    val busy = MutableStateFlow<String?>(null)
    val asks = Asks()

    suspend fun load() {
        try {
            val pull = remote.call { pull(ref) }
            page.value = coroutineScope {
                val ci = async { runCatching { remote.call { pullCiStatus(ref, pull.head.ref) } }.getOrNull() }
                val reviews = async { runCatching { remote.call { pullReviews(ref) }.items }.getOrDefault(emptyList()) }
                val files = async { runCatching { remote.call { pullFiles(ref) } }.getOrNull() }
                val comments = async { runCatching { remote.call { pullDiscussion(ref) }.items }.getOrDefault(emptyList()) }
                val f = files.await()
                PullPage(pull, ci.await(), reviews.await(), f?.items.orEmpty(), f?.nextPage != null, comments.await())
            }
            error.value = null
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
        }
    }

    private fun run(what: String, failed: String, job: suspend () -> Unit) {
        busy.value = what
        viewModelScope.launch {
            try {
                job()
                load()
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                asks.failure(e, failed, null)
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

    fun agent(job: suspend () -> Unit) = run("agent", "Couldn't start the thread", job)
}
