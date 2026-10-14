package dev.relay.android.features.home

import dev.relay.android.remote.model.DraftExtras
import dev.relay.android.remote.model.RemoteOverview

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

/** Every draft of the active computer worth listing, by key. */
fun interface DraftSource {
    fun list(overview: RemoteOverview?): Map<String, ListedDraft>
}

/** Any key set counts, as shared/drafts.ts's hasExtras. */
private fun DraftExtras.any() = screenshots != null || codeRefs != null || selection != null ||
    workItem != null || links != null || scope != null || branch != null

/**
 * Until the phone keeps its own draft copies (remote/drafts), list what the desktop holds.
 * TODO: swap for the drafts store once it lands, so local unsynced text and "here" show.
 */
val OverviewDrafts = DraftSource { overview ->
    overview?.drafts.orEmpty()
        .filter { it.text.isNotBlank() || it.extras?.any() == true }
        .associate { d ->
            val from = if (d.origin == "desktop") DraftFrom.Computer else DraftFrom.Phone
            d.key to ListedDraft(d.key, d.text, from, d.extras, d.at)
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
