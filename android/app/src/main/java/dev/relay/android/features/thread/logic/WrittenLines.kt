package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.WrittenCode

// What a call wrote, as lines to show: a whole file numbered, a swapped
// passage as a line diff (the desktop's `diffArrays`), a patch by its marks.

enum class LineMark { Same, Removed, Added, Hunk }

/**
 * One line shown. [text] is the code without a patch's mark; [index] is where
 * it sits in the text it came from ([before] for a removed line), so its
 * highlighting can be looked up there.
 */
data class WrittenLine(val mark: LineMark, val text: String, val index: Int, val before: Boolean = false)

/** The two texts a written file's lines index into, and its lines. */
data class WrittenView(val before: String, val after: String, val lines: List<WrittenLine>) {
    val added get() = lines.count { it.mark == LineMark.Added }
    val removed get() = lines.count { it.mark == LineMark.Removed }
    val diff get() = lines.any { it.mark != LineMark.Same }
}

fun writtenView(code: WrittenCode): WrittenView = when (code.kind) {
    "swap" -> swapView(code.edits.orEmpty().map { it.old to it.new })
    "patch" -> patchView(code.diff.orEmpty())
    else -> wholeView(code.content.orEmpty())
}

private fun wholeView(content: String): WrittenView {
    val lines = withoutLastNewline(content.split("\n")).mapIndexed { i, text -> WrittenLine(LineMark.Same, text, i) }
    return WrittenView("", content, lines)
}

/** A text ending in a newline doesn't have an empty last line to show. */
private fun withoutLastNewline(lines: List<String>) = if (lines.size > 1 && lines.last().isEmpty()) lines.dropLast(1) else lines

/** Every edit's passages, one after another, each diffed line by line. */
private fun swapView(edits: List<kotlin.Pair<String, String>>): WrittenView {
    val before = edits.joinToString("\n") { it.first }
    val after = edits.joinToString("\n") { it.second }
    val lines = mutableListOf<WrittenLine>()
    var oldAt = 0
    var newAt = 0
    for ((old, new) in edits) {
        val oldLines = old.split("\n")
        val newLines = new.split("\n")
        for (line in lineDiff(oldLines, newLines))
            lines += line.copy(index = line.index + if (line.before) oldAt else newAt)
        oldAt += oldLines.size
        newAt += newLines.size
    }
    return WrittenView(before, after, lines)
}

private val HUNK = Regex("^@@")

/**
 * A unified diff by its marks. Codex sends a new file's patch as its bare
 * content, with no hunk to mark anything; that reads as the whole file.
 */
private fun patchView(diff: String): WrittenView {
    val raw = diff.split("\n")
    if (raw.none { HUNK.containsMatchIn(it) }) return wholeView(diff)
    val body = withoutLastNewline(raw).filter { !it.startsWith("--- ") && !it.startsWith("+++ ") }
    val code = body.joinToString("\n") { if (HUNK.containsMatchIn(it)) "" else it.drop(1) }
    val lines = body.mapIndexed { i, line ->
        val mark = when {
            HUNK.containsMatchIn(line) -> LineMark.Hunk
            line.startsWith("+") -> LineMark.Added
            line.startsWith("-") -> LineMark.Removed
            else -> LineMark.Same
        }
        WrittenLine(mark, if (mark == LineMark.Hunk) line else line.drop(1), i)
    }
    return WrittenView(code, code, lines)
}

/** Past this many line pairs a passage shows as all removed, then all added. */
private const val MAX_DIFF_CELLS = 4_000_000

/**
 * The lines of [old] and [new] marked by a longest common subsequence: kept
 * lines are context, and within a change the removed lines come first.
 * [WrittenLine.index] points into [new] for kept and added lines, [old] for removed.
 */
fun lineDiff(old: List<String>, new: List<String>): List<WrittenLine> {
    val head = old.zip(new).takeWhile { (a, b) -> a == b }.size
    val tailRoom = minOf(old.size, new.size) - head
    val tail = (0 until tailRoom).takeWhile { old[old.size - 1 - it] == new[new.size - 1 - it] }.size
    val lines = mutableListOf<WrittenLine>()
    for (i in 0 until head) lines += WrittenLine(LineMark.Same, new[i], i)
    changedLines(old.subList(head, old.size - tail), new.subList(head, new.size - tail), head, lines)
    for (k in tail downTo 1) lines += WrittenLine(LineMark.Same, new[new.size - k], new.size - k)
    return lines
}

/** The middle of a passage, where it differs; [at] is where it starts on both sides. */
private fun changedLines(old: List<String>, new: List<String>, at: Int, out: MutableList<WrittenLine>) {
    val removed = { i: Int -> WrittenLine(LineMark.Removed, old[i], at + i, before = true) }
    val added = { j: Int -> WrittenLine(LineMark.Added, new[j], at + j) }
    if (old.size.toLong() * new.size > MAX_DIFF_CELLS) {
        old.indices.forEach { out += removed(it) }
        new.indices.forEach { out += added(it) }
        return
    }
    // common[i][j]: the longest run old[i..] and new[j..] share.
    val common = Array(old.size + 1) { IntArray(new.size + 1) }
    for (i in old.indices.reversed()) for (j in new.indices.reversed())
        common[i][j] = if (old[i] == new[j]) common[i + 1][j + 1] + 1 else maxOf(common[i + 1][j], common[i][j + 1])
    var i = 0
    var j = 0
    while (i < old.size || j < new.size) {
        val keep = i < old.size && j < new.size && old[i] == new[j]
        val dropOld = i < old.size && (j == new.size || common[i + 1][j] >= common[i][j + 1])
        if (keep) {
            out += WrittenLine(LineMark.Same, new[j], at + j)
            i++
            j++
        } else if (dropOld) out += removed(i++)
        else out += added(j++)
    }
}
