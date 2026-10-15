package dev.relay.android.features.home

import dev.relay.android.remote.model.RemoteProjectIcon
import kotlinx.serialization.Serializable

// The phone's index of project icons, kept apart per computer: each sync answers for one
// computer's projects, so it may only replace or drop that computer's icons.

@Serializable
data class IconEntry(val hash: String? = null, val path: String? = null)

/** Icons by computer, then by project id. */
typealias IconIndex = Map<String, Map<String, IconEntry>>

/** The hashes the phone holds for these projects of `computer`, to ask only for the rest. */
fun knownHashes(index: IconIndex, computer: String, projectIds: List<String>): Map<String, String?> {
    val mine = index[computer].orEmpty()
    return projectIds.filter { it in mine }.associateWith { mine.getValue(it).hash }
}

data class IconUpdate(val index: IconIndex, val unused: List<String>)

/**
 * The index once `computer` answered with `updates` for `projectIds`: changed icons replaced,
 * its removed projects' icons gone, other computers' untouched. `unused` are files nothing
 * points at any more.
 */
fun applyIconUpdates(
    index: IconIndex,
    computer: String,
    projectIds: List<String>,
    updates: Map<String, RemoteProjectIcon>,
    save: (id: String, hash: String, dataUrl: String) -> String?,
): IconUpdate {
    val mine = LinkedHashMap(index[computer].orEmpty())
    val unused = mutableListOf<String>()
    for ((id, icon) in updates) {
        val old = mine[id]?.path
        val hash = icon.hash
        val entry = if (hash != null) IconEntry(hash, icon.dataUrl?.let { save(id, hash, it) }) else IconEntry(null)
        mine[id] = entry
        if (old != null && old != entry.path) unused.add(old)
    }
    val keep = projectIds.toSet()
    for (id in mine.keys.toList()) if (id !in keep) {
        mine[id]?.path?.let(unused::add)
        mine.remove(id)
    }
    return IconUpdate(index + (computer to mine), unused)
}

/** Lookup stays scoped too: copied desktop state can share project ids. */
fun projectIconPath(index: IconIndex, computer: String?, projectId: String): String? =
    computer?.let { index[it]?.get(projectId)?.path }

private val iconExtensions = mapOf(
    "image/svg+xml" to "svg",
    "image/png" to "png",
    "image/webp" to "webp",
    "image/x-icon" to "ico",
    "image/vnd.microsoft.icon" to "ico",
)

private val dataUrlPattern = Regex("^data:([^;,]+);base64,(.*)$", RegexOption.DOT_MATCHES_ALL)

/** A data URL's file extension and base64 body, or null for a type the phone doesn't keep. */
fun iconData(dataUrl: String): Pair<String, String>? {
    val match = dataUrlPattern.find(dataUrl) ?: return null
    val extension = iconExtensions[match.groupValues[1]] ?: return null
    val data = match.groupValues[2].takeIf { it.isNotEmpty() } ?: return null
    return extension to data
}
