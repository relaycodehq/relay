package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.CallAction

// shared/trace-tree.ts: a finished run of tool calls grouped by what the calls
// did, not by the order they came in. The reads share a branch, the searches
// another, the commands a third; one or two calls of a kind stay a row. Held
// to the desktop by ts-trace-tree.json.

/** One row: a thing done, by one call or a few that did the same thing. */
data class TraceRow(
    val id: String,
    val action: CallAction,
    val calls: List<AgentActivity>,
    /** The lines each read of the file printed; none when a read took it whole. */
    val lines: List<String> = emptyList(),
    /** A script written, then run straight after. */
    val ranToo: Boolean = false,
)

enum class BranchKind { Read, Search, Web, Edit, Run, Git, Check, Commit, Tool }

sealed interface TracePiece {
    val id: String

    data class Row(val row: TraceRow) : TracePiece {
        override val id get() = row.id
    }

    data class Pair(val first: TraceRow, val second: TraceRow) : TracePiece {
        override val id get() = first.id
    }

    data class Branch(val kind: BranchKind, val heading: String, val rows: List<TraceRow>) : TracePiece {
        override val id get() = "${kind.name}:${rows.first().id}"
    }
}

/** A run whose calls all say what they did; an older desktop's don't. */
fun toldByActions(calls: List<AgentActivity>) = calls.isNotEmpty() && calls.all { it.actions != null }

fun rowRunning(row: TraceRow) = row.calls.any { it.status == "running" }

/** A test or check stopped before it said how it went. */
fun verdictStopped(row: TraceRow): Boolean {
    val ranChecks = row.action.kind == "test" || row.action.kind == "check"
    return ranChecks && !row.action.failed && row.calls.any { it.status == "stopped" }
}

/** A test or check fails by its result; anything else only when its call failed. */
fun rowFailed(row: TraceRow): Boolean {
    val ranChecks = row.action.kind == "test" || row.action.kind == "check"
    return if (ranChecks) row.action.failed else row.calls.any { it.status == "failed" }
}

/** A run's tree and, once it's longer than two lines, its folded line. */
data class TraceRun(val pieces: List<TracePiece>, val summary: String? = null)

/** A run of calls between two lines of commentary, as rows, pairs and branches. */
fun traceTree(calls: List<AgentActivity>): List<TracePiece> = traceRun(calls).pieces

/** A run's tree and, once it's longer than two lines, its folded line, from one pass over the calls. */
fun traceRun(calls: List<AgentActivity>): TraceRun {
    val grouped = branches(rowDrafts(calls)).map { (kind, drafts) -> kind to drafts.map(RowDraft::row) }
    val tree = grouped.flatMap { (kind, rows) ->
        val runs = if (kind == BranchKind.Run) commandRuns(rows) else listOf(rows)
        runs.flatMap { run -> pieces(kind, run) }
    }
    return if (tree.size < 3) TraceRun(tree) else TraceRun(tree, summaryOf(grouped))
}

/** A row per thing done, in the order the calls came: how a run shows while the agent is still on it. */
fun rowsOf(calls: List<AgentActivity>): List<TraceRow> = rowDrafts(calls).map(RowDraft::row)

/** The row a single call leads with: what the live batch's head names. */
fun leadRow(call: AgentActivity): TraceRow? = rowsOf(listOf(call)).firstOrNull()

private fun actionsOf(call: AgentActivity) = call.actions ?: listOf(CallAction("tool"))

/**
 * What a call did worth a row, each with where it stands among the call's
 * actions: a commit's own `git log` says nothing new, and a running call has
 * only started its first part.
 */
private fun shownActions(call: AgentActivity): List<IndexedValue<CallAction>> {
    val actions = actionsOf(call).withIndex().toList()
    if (call.status == "running") return actions.take(1)
    val committed = actions.any { it.value.kind == "commit" }
    return if (committed) actions.filter { it.value.kind != "git" } else actions
}

/** A row while rows are still merging into one another. */
private class RowDraft(val id: String, val action: CallAction, call: AgentActivity) {
    val calls = mutableListOf(call)
    val lines = mutableListOf<String>()
    var ranToo = false

    fun addOnce(call: AgentActivity) {
        if (calls.none { it === call }) calls += call
    }

    /** Another read's lines; none once either read took the whole file. */
    fun readAgain(later: List<String>) {
        if (lines.isEmpty() || later.isEmpty()) lines.clear() else lines += later
    }

    fun row() = TraceRow(id, action, calls.toList(), lines.toList(), ranToo)
}

/**
 * A row per thing done; a file read twice running, or a script written then
 * run, share one. A row is named by its call and action, so it keeps its id
 * when a call before it finishes and grows rows.
 */
private fun rowDrafts(calls: List<AgentActivity>): List<RowDraft> {
    val rows = mutableListOf<RowDraft>()
    for (call in calls) for ((index, action) in shownActions(call)) {
        val last = rows.lastOrNull()
        if (last != null && sameRead(last.action, action)) {
            last.addOnce(call)
            last.readAgain(listOfNotNull(action.lines))
            continue
        }
        if (last != null && ranWhatItWrote(last.action, action)) {
            last.addOnce(call)
            last.ranToo = true
            continue
        }
        val row = RowDraft("${call.id}:$index", action, call)
        if (action.kind == "read" && action.lines != null) row.lines += action.lines
        rows += row
    }
    return rows
}

private fun sameRead(a: CallAction, b: CallAction) = a.kind == "read" && b.kind == "read" && a.file == b.file

private fun isWrite(action: CallAction) = action.kind == "create" || action.kind == "edit"

private fun ranWhatItWrote(wrote: CallAction, ran: CallAction) =
    isWrite(wrote) && ran.kind == "run" && ran.what == baseName(wrote.file.orEmpty())

/** Which branch a row hangs on; a script written to /tmp to run is one of the commands. */
fun branchOf(action: CallAction): BranchKind = when (action.kind) {
    "read", "image" -> BranchKind.Read
    "search" -> BranchKind.Search
    "web" -> BranchKind.Web
    "edit", "create" -> if (isScratch(action.file.orEmpty())) BranchKind.Run else BranchKind.Edit
    "test", "check" -> BranchKind.Check
    "commit" -> BranchKind.Commit
    "git" -> BranchKind.Git
    "tool" -> BranchKind.Tool
    else -> BranchKind.Run
}

/** Rows by branch, in the order each first came up; a file read or edited again joins its first row. */
private fun branches(rows: List<RowDraft>): List<kotlin.Pair<BranchKind, List<RowDraft>>> {
    val byKind = LinkedHashMap<BranchKind, MutableList<RowDraft>>()
    for (row in rows) {
        val branch = byKind.getOrPut(branchOf(row.action)) { mutableListOf() }
        val earlier = branch.find { sameFile(it, row) }
        if (earlier == null) {
            branch += row
            continue
        }
        val newCalls = row.calls.filter { call -> earlier.calls.none { it === call } }
        earlier.calls += newCalls
        earlier.readAgain(row.lines)
    }
    return byKind.map { (kind, list) -> kind to list }
}

/** Two reads, or two edits, of one file; a script written and run stays apart. */
private fun sameFile(a: RowDraft, b: RowDraft): Boolean {
    val bothReads = a.action.kind == "read" && b.action.kind == "read"
    val bothEdits = a.action.kind == "edit" && b.action.kind == "edit"
    if (!(bothReads || bothEdits) || a.ranToo || b.ranToo) return false
    return a.action.file != null && a.action.file == b.action.file
}

/** Commands split at each script written for them, so a write isn't buried in "Ran 7 commands". */
private fun commandRuns(rows: List<TraceRow>): List<List<TraceRow>> {
    val runs = mutableListOf<MutableList<TraceRow>>()
    for (row in rows) {
        val last = runs.lastOrNull()
        val joinsLast = last != null && !isWrite(row.action) && !isWrite(last.first().action)
        if (joinsLast) last!! += row else runs += mutableListOf(row)
    }
    return runs
}

/** One row alone, two as one sentence when one verb carries both, three and up a branch. */
private fun pieces(kind: BranchKind, rows: List<TraceRow>): List<TracePiece> = when (rows.size) {
    1 -> listOf(TracePiece.Row(rows[0]))
    2 -> if (pairable(rows[0], rows[1])) listOf(TracePiece.Pair(rows[0], rows[1])) else rows.map { TracePiece.Row(it) }
    else -> listOf(TracePiece.Branch(kind, branchHeading(kind, rows), rows))
}

/** Kinds two rows of can share one line; two pictures keep their own rows, each with its thumbnail. */
private val pairVerbs = setOf("read", "search", "web", "edit", "create", "run", "git")

/** Two rows one verb can carry: same action, both settled and fine, said the same way. */
private fun pairable(a: TraceRow, b: TraceRow): Boolean {
    val sameAction = a.action.kind == b.action.kind && a.action.kind in pairVerbs
    val settled = !rowRunning(a) && !rowRunning(b) && !rowFailed(a) && !rowFailed(b)
    return sameAction && settled && a.ranToo == b.ranToo
}

private fun distinctFiles(rows: List<TraceRow>) = rows.map { it.action.file ?: it.id }.toSet().size

/** "Read 4 files", "Ran rg 3 times", "Ran 2 checks · 1 failed". */
fun branchHeading(kind: BranchKind, rows: List<TraceRow>): String = when (kind) {
    BranchKind.Read -> "Read ${plural(distinctFiles(rows), "file")}"
    BranchKind.Search -> "Searched ${times(rows.size)}"
    BranchKind.Web -> "Searched the web ${times(rows.size)}"
    BranchKind.Edit -> "Edited ${plural(distinctFiles(rows), "file")}"
    BranchKind.Run -> runHeading(rows)
    BranchKind.Git -> "Checked git ${times(rows.size)}"
    BranchKind.Check -> checksHeading(rows)
    BranchKind.Commit -> "Committed ${times(rows.size)}"
    BranchKind.Tool -> toolsHeading(rows)
}

/** "once", "twice", "3 times". */
private fun times(count: Int) = when (count) {
    1 -> "once"
    2 -> "twice"
    else -> "$count times"
}

/** Commands all of one program say which: "Ran rg 3 times". Counted as the rows under it. */
private fun runHeading(rows: List<TraceRow>): String {
    val programs = rows.map { if (it.action.kind == "run") it.action.what.orEmpty().split(" ")[0] else it.id }.toSet()
    if (programs.size != 1) return "Ran ${plural(rows.size, "command")}"
    return if (rows.size == 1) "Ran ${programs.first()}" else "Ran ${programs.first()} ${rows.size} times"
}

private fun checksHeading(rows: List<TraceRow>): String {
    val failed = rows.count(::rowFailed)
    val ran = "Ran ${plural(rows.size, "check")}"
    return if (failed > 0) "$ran · $failed failed" else ran
}

private fun toolsHeading(rows: List<TraceRow>): String {
    val allAgents = rows.all { row -> row.calls.all { it.kind == "agent" } }
    return if (allAgents) "Ran ${plural(rows.size, "agent")}" else "Used ${plural(rows.size, "tool")}"
}

/** How many kinds a folded run's line names before "and N more". */
private const val SUMMARY_KINDS = 3

/** A run the agent has moved on from, as one line: "Searched twice, read 4 files and ran 3 commands". */
private fun summaryOf(grouped: List<kotlin.Pair<BranchKind, List<TraceRow>>>): String {
    val parts = grouped.mapIndexed { index, (kind, rows) ->
        val heading = branchHeading(kind, rows)
        if (index == 0) heading else heading.replaceFirstChar { it.lowercaseChar() }
    }
    if (parts.size > SUMMARY_KINDS)
        return "${parts.take(SUMMARY_KINDS - 1).joinToString(", ")} and ${parts.size - SUMMARY_KINDS + 1} more"
    return if (parts.size == 1) parts[0] else "${parts.dropLast(1).joinToString(", ")} and ${parts.last()}"
}

/** The verb a row leads with, past or, while it runs, present. Tools draw their own row. */
fun actionVerb(row: TraceRow, live: Boolean = false): String {
    val a = row.action
    return when (a.kind) {
        "read" -> if (live) "Reading" else "Read"
        "image" -> if (live) "Looking at" else "Looked at"
        "search" -> if (live) "Searching" else "Searched"
        "web" -> if (live) "Searching the web for" else "Searched the web for"
        "edit" -> if (live) "Editing" else "Edited"
        "create" -> if (live) "Writing" else "Wrote"
        "test" -> testVerb(row, live)
        "check" -> checkVerb(row, live)
        "commit" -> if (live) "Committing" else "Committed"
        "git" -> if (live) "Checking" else "Checked"
        "run" -> if (live) "Running" else "Ran"
        else -> ""
    }
}

private fun testVerb(row: TraceRow, live: Boolean) = if (live) "Running tests" else "Tests ${verdictWord(row)}"

private fun checkVerb(row: TraceRow, live: Boolean): String {
    val name = row.action.name.orEmpty()
    if (live) return "Running $name"
    return "${name.replaceFirstChar { it.uppercaseChar() }} ${verdictWord(row)}"
}

private fun verdictWord(row: TraceRow) = when {
    rowFailed(row) -> "failed"
    verdictStopped(row) -> "stopped"
    else -> "passed"
}

private val PATTERN_ANCHORS = Regex("^\\^|\\\\b|\\$$")
private val PATTERN_ESCAPE = Regex("\\\\(.)")

/** A grep's alternation reads as its first word, without its escapes. */
fun shortPattern(pattern: String): String {
    val first = pattern.split("\\|")[0].replace(PATTERN_ANCHORS, "").replace(PATTERN_ESCAPE, "$1")
    return if (first.length > 34) "${first.take(32)}…" else first
}

/** Where a search looked: a path's last two folders. */
fun shortWhere(where: String): String {
    val parts = where.split(" ")[0].split("/").filter { it.isNotEmpty() }
    return if (parts.size > 2) "…/${parts.takeLast(2).joinToString("/")}" else parts.joinToString("/")
}

private val SCRATCH = Regex("^/(?:private/)?tmp/")

/** Scratch files an agent writes for itself, outside any project. */
fun isScratch(path: String) = SCRATCH.containsMatchIn(path)
