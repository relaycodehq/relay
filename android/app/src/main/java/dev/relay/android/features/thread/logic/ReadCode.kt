package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity

// `shared/read-code.ts`: what a read printed, taken back to the file's own
// lines, so it can open highlighted in the file's language beside the file's
// line numbers. Claude's Read and `nl -ba` number every line; `sed -n 115,135p`
// starts at 115.

/** The file a read printed, its lines, and the number of the first when the output says it. */
data class ReadCode(val file: String, val code: String, val first: Long? = null)

/** A line `cat -n` style: its number, a tab (an arrow in older Claude Code), then the line. */
private val numberedLine = Regex("""\s*(\d+)(?:\t|→)(.*)""")

private data class NumberedLine(val n: Long, val text: String)

/** The file a call read and the lines it printed; none for a call that read several, or failed. */
fun readCode(call: AgentActivity): ReadCode? {
    val detail = call.detail
    if (detail.isNullOrEmpty() || call.status == "failed") return null
    val read = call.actions?.singleOrNull()
    if (read?.kind != "read") return null
    val file = read.file.orEmpty()
    val lines = detail.removeSuffix("\n").split("\n")
    val numbered = numberedRun(lines)
    // Claude's Read always numbers its lines; a command's output only counts as numbered when most of it is.
    val isNumbered = numbered.isNotEmpty() && (call.kind == "read" || numbered.size * 2 >= lines.size)
    if (isNumbered) return ReadCode(file, numbered.joinToString("\n") { it.text }, numbered.first().n)
    return ReadCode(file, lines.joinToString("\n"), rangeStart(lines, read.lines))
}

/** Where the desktop joined the start and the end of an output it cut for the phone. */
private const val CUT_MARK = "\n…\n"

/**
 * What a read printed, once its output is whole: the desktop's [fetched] copy
 * of a cut one, or the detail as sent when nothing was cut. A subagent's call
 * loses its `detailCut` on the way and can't be fetched, so the cut mark is
 * what tells. Read from a cut output, the mark would show as a line of code.
 */
fun readCodeWhenWhole(call: AgentActivity, fetched: String?): ReadCode? {
    if (fetched != null) return readCode(call.copy(detail = fetched, detailCut = null))
    val cut = (call.detailCut ?: 0) > 0 || CUT_MARK in call.detail.orEmpty()
    return if (cut) null else readCode(call)
}

/**
 * The longest run of numbered lines counting up from the top. Output kept from
 * its end may start mid-line, so the run can start on the second line; it
 * stops where something was appended after the file, like a reminder.
 */
private fun numberedRun(lines: List<String>): List<NumberedLine> {
    fun runFrom(start: Int): List<NumberedLine> {
        val run = mutableListOf<NumberedLine>()
        for (line in lines.drop(start)) {
            val found = numberedLine.matchEntire(line) ?: break
            val n = found.groupValues[1].toLongOrNull() ?: break
            if (run.isNotEmpty() && n != run.last().n + 1) break
            run += NumberedLine(n, found.groupValues[2])
        }
        return run
    }
    val fromTop = runFrom(0)
    val fromSecond = runFrom(1)
    return if (fromSecond.size > fromTop.size) fromSecond else fromTop
}

/** Where `sed -n 115,135p` started, when it printed every line it asked for; output cut short has fewer. */
private fun rangeStart(lines: List<String>, range: String?): Long? {
    val bounds = range.orEmpty().split("–").map { it.toLongOrNull() ?: 0L }
    val from = bounds.getOrElse(0) { 0L }
    val to = bounds.getOrElse(1) { 0L }
    val printedAll = lines.size.toLong() == to - from + 1
    return if (from != 0L && to != 0L && printedAll) from else null
}
