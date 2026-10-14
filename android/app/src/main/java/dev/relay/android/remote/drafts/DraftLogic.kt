package dev.relay.android.remote.drafts

import dev.relay.android.remote.model.DraftExtras
import dev.relay.android.remote.model.SharedDraft
import kotlinx.serialization.Serializable

// shared/drafts.ts: the rules every screen of one computer shares.

/** A composer's text, and what makes the desktop's pills in it. */
@Serializable
data class DraftBody(
    val text: String,
    val skills: Map<String, String>? = null,
    val quotes: List<String>? = null,
    val files: List<String>? = null,
    val workspace: String? = null,
) {
    /** The parts every screen carries, with the empty ones left out. */
    fun normal() = DraftBody(
        text,
        skills?.takeIf { it.isNotEmpty() },
        quotes?.takeIf { it.isNotEmpty() },
        files?.takeIf { it.isNotEmpty() },
        workspace?.takeIf { it.isNotEmpty() },
    )
}

fun SharedDraft.body() = DraftBody(text, skills, quotes, files, workspace).normal()

fun sameBody(a: DraftBody, b: DraftBody) = a.normal() == b.normal()

fun phoneDevice(deviceId: String) = "phone:$deviceId"

private const val ID = "[A-Za-z0-9_-]{1,80}"
val draftKeyPattern = Regex("^(?:$ID(?::$ID)?|new:$ID(?::[a-z0-9]{1,16})?)$")

/** The project of an unsent thread's draft. */
fun newDraftProject(key: String) = Regex("^new:([^:]+)(?::[^:]+)?$").find(key)?.groupValues?.get(1)

data class DraftThread(val chatId: String, val root: String?)

/** The thread a draft is in, and the side conversation if it's a reply's. */
fun draftThread(key: String): DraftThread? {
    if (key.startsWith("new:")) return null
    val parts = key.split(":")
    return DraftThread(parts[0], parts.getOrNull(1))
}

fun hasExtras(extras: DraftExtras?) = extras != null && extras != DraftExtras()

/** Nothing typed and nothing held: no draft at all. */
internal fun emptied(body: DraftBody, extras: DraftExtras?) = body.text.isBlank() && !hasExtras(extras)

/** A screen's copy of a draft, and how it stands with the computer's. */
interface LocalDraft {
    val body: DraftBody
    val extras: DraftExtras?
    /** The computer's rev it last matched. */
    val synced: Long?
    /** When it was edited here without the computer taking it yet. */
    val dirty: Long?
}

data class Reconciled(val take: List<SharedDraft>, val drop: List<String>, val push: List<String>)

/**
 * What a screen does once it hears the computer's drafts: take the computer's
 * copy, drop its own once the computer no longer has it, and push what
 * changed here meanwhile or never went.
 */
fun reconcileDrafts(local: Map<String, LocalDraft>, shared: List<SharedDraft>): Reconciled {
    val take = mutableListOf<SharedDraft>()
    val drop = mutableListOf<String>()
    val push = mutableListOf<String>()
    val theirs = shared.associateBy { it.key }
    for ((key, mine) in local) {
        val draft = theirs[key]
        val typed = !emptied(mine.body, mine.extras)
        if (mine.dirty != null || (mine.synced == null && typed && draft == null)) push += key
        else if (draft != null && mine.synced != draft.rev) {
            // Never synced, but there: the same thing typed on both is no clash.
            if (mine.synced == null && typed && !sameBody(mine.body, draft.body())) push += key
            else take += draft
        } else if (draft == null && mine.synced != null) drop += key
    }
    for (draft in shared) if (draft.key !in local) take += draft
    return Reconciled(take, drop, push)
}

/** "2 screenshots, a code reference and a selected line": what stays on the computer. */
fun extrasSummary(extras: DraftExtras?): String {
    if (extras == null) return ""
    fun count(n: Int, one: String) = if (n == 1) "a $one" else "$n ${one}s"
    val parts = listOfNotNull(
        extras.screenshots?.takeIf { it.isNotEmpty() }?.let { count(it.size, "screenshot") },
        extras.codeRefs?.takeIf { it > 0 }?.let { count(it, "code reference") },
        "a selected line".takeIf { extras.selection == true },
        "a work item".takeIf { extras.workItem == true },
        extras.links?.takeIf { it > 0 }?.let { count(it, "linked folder") },
        "a pull request".takeIf { extras.scope == "pr" },
        "a review".takeIf { extras.scope == "review" },
        "a branch name".takeIf { extras.branch == true },
    )
    return if (parts.size < 2) parts.firstOrNull() ?: ""
    else parts.dropLast(1).joinToString(", ") + " and " + parts.last()
}
