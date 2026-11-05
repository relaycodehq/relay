package dev.relay.android.remote

import dev.relay.android.remote.credentials.fileSafe
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.RemoteOverview
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/** Each computer's last overview, shown while it connects or can't. One JSON file per computer. */
class OfflineCache(private val dir: File) {
    private fun file(id: String) = File(dir, "${fileSafe(id)}.json")

    /**
     * A running thread's list changes faster than the disk takes it, and the saves share one
     * temp file: one at a time, in the order they came, or they write over each other.
     */
    private val writing = Mutex()

    suspend fun load(id: String): RemoteOverview? = withContext(Dispatchers.IO) {
        try {
            file(id).takeIf { it.exists() }?.readText()?.let { RemoteJson.decodeFromString<RemoteOverview>(it) }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun save(id: String, overview: RemoteOverview): Unit = writing.withLock {
        withContext(Dispatchers.IO) {
            try {
                dir.mkdirs()
                val tmp = File(dir, "${fileSafe(id)}.tmp")
                tmp.writeText(RemoteJson.encodeToString(overview))
                tmp.renameTo(file(id))
            } catch (_: Exception) {
            }
        }
    }

    /**
     * The overview and the computer's folder beside it (the composer's saved model lists and
     * new-thread start), after the saves still waiting, which would otherwise put the overview back.
     */
    suspend fun forget(id: String): Unit = writing.withLock {
        withContext(Dispatchers.IO) {
            file(id).delete()
            File(dir, fileSafe(id)).deleteRecursively()
        }
    }
}
