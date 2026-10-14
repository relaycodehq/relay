package dev.relay.android.features.composer

import dev.relay.android.features.composer.logic.ModelCatalogs
import dev.relay.android.features.composer.logic.NewThreadModels
import dev.relay.android.remote.credentials.fileSafe
import dev.relay.android.remote.model.ResumeSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import java.io.File

/** What a new thread starts on, so its composer is there before the computer answers. */
@Serializable
data class SavedNewThread(val settings: ResumeSettings, val models: NewThreadModels)

/**
 * mobile/src/remote/offline.ts's models.json and new-thread.json: the agents'
 * model lists and a new thread's start as each computer last said them, so a
 * composer names its model before the computer answers. They sit in that
 * computer's folder of the offline cache, beside its overview.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ComposerSaves(private val root: File) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
    // One writer, in order: a later save of a file never lands under an earlier one.
    private val io = Dispatchers.IO.limitedParallelism(1)
    private val scope = CoroutineScope(SupervisorJob() + io)

    private fun file(computer: String, name: String) = File(File(root, fileSafe(computer)), name)

    private suspend fun <T> read(file: File, serializer: KSerializer<T>): T? = withContext(io) {
        runCatching { if (file.exists()) json.decodeFromString(serializer, file.readText()) else null }.getOrNull()
    }

    private fun <T> write(file: File, serializer: KSerializer<T>, value: T): Job =
        scope.launch {
            // A full disk costs the saved copy, nothing else.
            runCatching {
                file.parentFile?.mkdirs()
                val tmp = File(file.parentFile, "${file.name}.tmp")
                tmp.writeText(json.encodeToString(serializer, value))
                if (!tmp.renameTo(file)) {
                    file.delete()
                    tmp.renameTo(file)
                }
            }
        }

    suspend fun models(computer: String): ModelCatalogs? = read(file(computer, "models.json"), serializer())
    fun saveModels(computer: String, lists: ModelCatalogs) = write(file(computer, "models.json"), serializer(), lists)

    suspend fun newThread(computer: String): SavedNewThread? = read(file(computer, "new-thread.json"), serializer())
    fun saveNewThread(computer: String, start: SavedNewThread) = write(file(computer, "new-thread.json"), serializer(), start)

    companion object {
        @Volatile private var one: ComposerSaves? = null
        /** The app's one copy, in [cacheDir]'s relay-offline folder as OfflineCache keeps the overviews. */
        fun of(cacheDir: File): ComposerSaves =
            one ?: synchronized(this) { one ?: ComposerSaves(File(cacheDir, "relay-offline")).also { one = it } }
    }
}
