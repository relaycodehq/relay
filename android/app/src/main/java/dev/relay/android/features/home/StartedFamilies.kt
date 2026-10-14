package dev.relay.android.features.home

import dev.relay.android.remote.model.RemoteChatSummary

// Port of shared/started-families.ts and family-folds.ts: threads another thread's agent
// started sit under their lead.

private fun startedRank(c: RemoteChatSummary) = if (c.waiting == true) 0 else if (c.running == true) 1 else 2

/** Needs the user first, then working, then done; each oldest first. */
val byStanding: Comparator<RemoteChatSummary> = compareBy<RemoteChatSummary> { startedRank(it) }.thenBy { it.created }

data class StartedFamilies(
    /** Cards in order, with settled leads coming back as headers above their threads. */
    val top: List<RemoteChatSummary>,
    /** `top` without those headers. */
    val cards: List<RemoteChatSummary>,
    val started: Map<String, List<RemoteChatSummary>>,
    /** Settled leads shown as headers, which the Settled shelf leaves out. */
    val headers: Set<String>,
)

fun startedFamilies(active: List<RemoteChatSummary>, settled: List<RemoteChatSummary> = emptyList()): StartedFamilies {
    val listed = active.map { it.id }.toSet()
    val resting = settled.associateBy { it.id }
    val started = LinkedHashMap<String, MutableList<RemoteChatSummary>>()
    for (c in active) {
        val lead = c.startedBy?.chatId
        if (lead != null && lead.isNotEmpty() && (lead in listed || lead in resting)) started.getOrPut(lead) { mutableListOf() }.add(c)
    }
    val sorted = started.mapValues { (_, children) -> children.sortedWith(byStanding) }
    val top = mutableListOf<RemoteChatSummary>()
    val headers = LinkedHashSet<String>()
    for (c in active) {
        val lead = c.startedBy?.chatId ?: ""
        if (lead !in sorted) top.add(c)
        else if (lead in resting && lead !in headers) {
            headers.add(lead)
            top.add(resting.getValue(lead))
        }
    }
    return StartedFamilies(top, top.filter { it.id !in headers }, sorted, headers)
}

/** "4 threads · 1 working · 1 needs you", on the lead's card. */
fun familyLine(started: List<RemoteChatSummary>): String {
    val asking = started.count { it.waiting == true }
    val working = started.count { it.running == true && !inputBlocksThread(it) }
    return listOfNotNull(
        "${started.size} thread${if (started.size == 1) "" else "s"}",
        if (working > 0) "$working working" else null,
        if (asking > 0) "$asking need${if (asking == 1) "s" else ""} you" else null,
        if (working == 0 && asking == 0) "all done" else null,
    ).joinToString(" · ")
}

/** Every thread in the family is done and read: it folds until something happens. */
fun familySettled(started: List<RemoteChatSummary>, unread: (RemoteChatSummary) -> Boolean) =
    started.all { it.running != true && it.waiting != true && it.pending.isNullOrEmpty() && !unread(it) }

/** How many toggled families are remembered, so leads long gone don't pile up. */
private const val KEEP_FOLDS = 200

/** `folds` with `lead` set, moved to the newest end and the oldest past the cap dropped. */
fun withFamilyFold(folds: Map<String, Boolean>, lead: String, open: Boolean): Map<String, Boolean> {
    val entries = folds.entries.filter { it.key != lead }.map { it.key to it.value } + (lead to open)
    return LinkedHashMap<String, Boolean>().apply { entries.takeLast(KEEP_FOLDS).forEach { put(it.first, it.second) } }
}
