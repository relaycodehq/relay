package dev.relay.android.features.thread

import dev.relay.android.remote.credentials.fileSafe
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteJson
import java.io.File

/**
 * Threads kept for reading offline (mobile/src/remote/offline.ts): each paired
 * computer keeps its own copies, the 20 most recently saved, and the last few
 * read stay in memory so reopening one draws its first frame from it.
 */
class ThreadCache(private val root: File) {
    private val remembered = object : LinkedHashMap<String, RemoteChat>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, RemoteChat>) = size > REMEMBERED
    }

    private fun folder(computer: String) = File(root, fileSafe(computer))
    private fun file(computer: String, id: String) = File(folder(computer), "thread-${fileSafe(id)}.json")

    /** The saved copy, read at once: the screen's first frame needs it. */
    @Synchronized
    fun now(computer: String?, id: String): RemoteChat? {
        if (computer == null) return null
        val file = file(computer, id)
        remembered[file.path]?.let { return it }
        return try {
            file.takeIf { it.exists() }?.readText()?.let { RemoteJson.decodeFromString<RemoteChat>(it) }
                ?.also { remembered[file.path] = it }
        } catch (_: Exception) {
            null
        }
    }

    @Synchronized
    fun save(computer: String?, id: String, thread: RemoteChat) {
        if (computer == null) return
        val file = file(computer, id)
        remembered[file.path] = thread
        try {
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, "${file.name}.tmp")
            tmp.writeText(RemoteJson.encodeToString(thread))
            tmp.renameTo(file)
            val threads = folder(computer).listFiles { f -> f.name.startsWith("thread-") && f.name.endsWith(".json") }
                ?.sortedByDescending { it.lastModified() } ?: return
            for (old in threads.drop(KEEP)) old.delete()
        } catch (_: Exception) {
        }
    }

    private companion object {
        const val KEEP = 20
        const val REMEMBERED = 8
    }
}
