package dev.relay.android.features.files

/** Search results stop here; the phone isn't where to scroll a whole monorepo. */
const val MAX_SEARCH_RESULTS = 300

data class FileEntry(val path: String, val folder: Boolean) {
    val name: String get() = path.substringAfterLast('/')
}

/**
 * What the Files screen lists (mobile/src/app/files.tsx): with a [query],
 * every path containing it, any case, capped; otherwise the folders directly
 * under [dir] and then its own files, each sorted.
 */
fun fileEntries(files: List<String>, dir: String, query: String): List<FileEntry> {
    val q = query.trim().lowercase()
    if (q.isNotEmpty()) return files.asSequence()
        .filter { it.lowercase().contains(q) }
        .take(MAX_SEARCH_RESULTS)
        .map { FileEntry(it, false) }
        .toList()
    val prefix = if (dir.isEmpty()) "" else "$dir/"
    val folders = sortedSetOf<String>()
    val here = mutableListOf<String>()
    for (f in files) {
        if (!f.startsWith(prefix)) continue
        val rest = f.substring(prefix.length)
        val slash = rest.indexOf('/')
        if (slash >= 0) folders += prefix + rest.substring(0, slash) else here += f
    }
    return folders.map { FileEntry(it, true) } + here.sorted().map { FileEntry(it, false) }
}
