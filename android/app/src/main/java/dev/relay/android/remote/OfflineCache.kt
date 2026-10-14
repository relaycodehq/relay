package dev.relay.android.remote

import dev.relay.android.remote.credentials.fileSafe
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.RemoteOverview
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Each computer's last overview, shown while it connects or can't. One JSON file per computer. */
class OfflineCache(private val dir: File) {
    private fun file(id: String) = File(dir, "${fileSafe(id)}.json")

    suspend fun load(id: String): RemoteOverview? = withContext(Dispatchers.IO) {
        try {
            file(id).takeIf { it.exists() }?.readText()?.let { RemoteJson.decodeFromString<RemoteOverview>(it) }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun save(id: String, overview: RemoteOverview) = withContext(Dispatchers.IO) {
        try {
            dir.mkdirs()
            val tmp = File(dir, "${fileSafe(id)}.tmp")
            tmp.writeText(RemoteJson.encodeToString(overview))
            tmp.renameTo(file(id))
        } catch (_: Exception) {
        }
        Unit
    }

    suspend fun forget(id: String) = withContext(Dispatchers.IO) { file(id).delete(); Unit }
}
