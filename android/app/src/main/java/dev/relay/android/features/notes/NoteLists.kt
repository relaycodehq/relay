package dev.relay.android.features.notes

// Ports of shared/thread-notes.ts: a note that is a list ticks off, and only
// its unfinished part goes into a message.

import dev.relay.android.remote.model.ThreadNote

/** `3.` for a numbered item, empty for a bullet; [text] is its markdown, nested lines unindented. */
data class NoteItem(val number: String, val text: String)

data class NoteList(val lead: String, val items: List<NoteItem>)

private val ITEM = Regex("""^ {0,3}(?:[-*+]|(\d{1,9})[.)])[ \t]+(.*)$""")
private val FENCE = Regex("""^ {0,3}(`{3,}|~{3,})""")

/**
 * The note as a list to tick off, when it is one: optional lines leading
 * into a single top-level list with nothing after it.
 */
fun noteList(text: String): NoteList? {
    val lines = text.replace(Regex("\r\n?"), "\n").trimEnd().split("\n")
    var fence: String? = null
    var start = -1
    for ((index, line) in lines.withIndex()) {
        val opening = FENCE.find(line)?.groupValues?.get(1)
        val open = fence
        if (open != null) {
            if (opening != null && opening[0] == open[0] && opening.length >= open.length) fence = null
            continue
        }
        if (opening != null) {
            fence = opening
            continue
        }
        if (ITEM.containsMatchIn(line)) {
            start = index
            break
        }
    }
    if (start < 0) return null
    val items = ArrayList<NoteItem>()
    // Where the current item's text starts; lines indented that far are its own.
    var column = 0
    var blank = false
    for (raw in lines.drop(start)) {
        val line = raw.replace("\t", "    ")
        val indent = line.length - line.trimStart(' ').length
        val item = ITEM.find(line)
        if (line.isBlank()) blank = true
        else if (items.isNotEmpty() && indent >= column) {
            val last = items.removeAt(items.lastIndex)
            items += last.copy(text = last.text + "\n" + (if (blank) "\n" else "") + line.substring(minOf(column, line.length)))
            blank = false
        } else if (item != null) {
            val number = item.groupValues[1]
            val body = item.groupValues[2]
            items += NoteItem(if (number.isNotEmpty()) "$number." else "", body)
            column = line.length - body.length
            blank = false
        } else if (!blank) {
            // A lazy line right under an item still belongs to it.
            val last = items.removeAt(items.lastIndex)
            items += last.copy(text = last.text + "\n" + line.trim())
        } else return null
    }
    return NoteList(lines.take(start).joinToString("\n").trim(), items)
}

/** Markdown for the draft: only unfinished work, or one unfinished item ([index] from 0). */
fun noteQuote(note: ThreadNote, index: Int? = null): String {
    if (note.ref == true) return if (index == null) note.text else ""
    val list = noteList(note.text) ?: return if (index == null) note.text else ""
    val done = note.done.orEmpty().toSet()
    val remaining = list.items.filterIndexed { i, _ -> i !in done && (index == null || index == i) }
    if (remaining.isEmpty()) return ""
    if (index == null && remaining.size == list.items.size) return note.text
    val items = remaining.map { itemMarkdown(it, it.number) }
    return (listOf(if (index == null) list.lead else "") + items).filter { it.isNotEmpty() }.joinToString("\n\n")
}

private fun itemMarkdown(item: NoteItem, number: String): String {
    val marker = "${number.ifEmpty { "-" }} "
    return item.text.split("\n").mapIndexed { i, line ->
        if (i == 0) marker + line else if (line.isNotEmpty()) " ".repeat(marker.length) + line else ""
    }.joinToString("\n")
}

/** `notesMark`: what the thread's summary says of these notes, so the phone's own change needs no fetch. */
fun notesMark(notes: List<ThreadNote>): String? =
    if (notes.isEmpty()) null else "${notes.size}.${notes.maxOf { it.updated }}"

/** The item ([index] from 0) ticked or unticked here, before the computer says so. */
internal fun ticked(notes: List<ThreadNote>, id: String, index: Int, done: Boolean): List<ThreadNote> = notes.map { n ->
    if (n.id != id) n
    else {
        val next = (n.done.orEmpty().toSet().let { if (done) it + index else it - index }).sorted()
        n.copy(done = next.ifEmpty { null })
    }
}
