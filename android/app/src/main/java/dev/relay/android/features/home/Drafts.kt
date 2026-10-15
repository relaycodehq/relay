package dev.relay.android.features.home

import dev.relay.android.remote.Remote
import dev.relay.android.remote.drafts.DraftStore
import dev.relay.android.remote.model.DraftExtras
import dev.relay.android.remote.model.RemoteOverview
import kotlinx.coroutines.flow.StateFlow

/** Where a draft was started, from this phone's point of view. */
enum class DraftFrom { Here, Computer, Phone }

/** A draft as a list shows it (mobile/src/remote/drafts.ts's ListedDraft). */
data class ListedDraft(
    val key: String,
    val text: String,
    val from: DraftFrom,
    /** What the computer holds of it, a screenshot alone being a draft too. */
    val extras: DraftExtras? = null,
    val at: Long,
)

/** Every draft of the active computer worth listing, by key; [version] moves when that list may have changed. */
interface DraftSource {
    val version: StateFlow<Long>
    fun list(overview: RemoteOverview?): Map<String, ListedDraft>
}

/** The phone's own draft copies (remote/drafts), so text not synced yet and drafts started here show too. */
class StoreDrafts(private val store: DraftStore, private val remote: Remote) : DraftSource {
    override val version get() = store.version
    override fun list(overview: RemoteOverview?) = store.listed(remote.active.value).mapValues { (_, d) ->
        val from = when (d.from) {
            "here" -> DraftFrom.Here
            "computer" -> DraftFrom.Computer
            else -> DraftFrom.Phone
        }
        ListedDraft(d.key, d.text, from, d.extras, d.at)
    }
}

/** The draft a thread's row shows: its main conversation's, else a side one's. */
fun threadDraft(drafts: Map<String, ListedDraft>, chatId: String): ListedDraft? =
    drafts[chatId] ?: drafts.entries.firstOrNull { it.key.startsWith("$chatId:") }?.value

private val newDraftKey = Regex("^new:([^:]+)(?::[^:]+)?$")

/** The project a new-thread draft is for, from its key. */
fun newDraftProject(key: String): String? = newDraftKey.find(key)?.groupValues?.get(1)

/** A draft's text where a row shows its branch. */
fun draftText(draft: ListedDraft): String {
    val shots = draft.extras?.screenshots?.size ?: 0
    return draft.text.replace(Regex("\\s+"), " ").trim().ifEmpty {
        when (shots) {
            0 -> "Draft"
            1 -> "Screenshot"
            else -> "$shots screenshots"
        }
    }
}
