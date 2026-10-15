package dev.relay.android.remote.credentials

import dev.relay.android.remote.model.RemoteCredentials
import dev.relay.android.remote.model.RemoteJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File

/** Pairing order, oldest first; ids are the computers' public keys. */
@Serializable
data class Paired(val ids: List<String> = emptyList(), val active: String? = null)

data class LoadedPairings(val paired: Paired, val computers: List<RemoteCredentials>)

/**
 * Paired computers (mobile/src/remote/credentials.ts): an index of ids and
 * the active one, and one record per computer keyed by its desktop key, each
 * a file sealed by [box]. A file that won't open counts as missing for this
 * run but stays listed, so a Keystore that fails once doesn't unpair it.
 */
class CredentialStore(private val dir: File, private val box: SecretBox = KeystoreBox()) {
    private val lock = Mutex()
    private val index get() = File(dir, "computers.bin")
    private fun computer(id: String) = File(dir, "computer-${fileSafe(id)}.bin")

    /** Paired ids whose files are there but wouldn't open; kept in the index. */
    private var unreadable = emptyList<String>()

    suspend fun load(): LoadedPairings = io {
        val paired = try {
            read<Paired>(index) ?: Paired()
        } catch (_: Exception) {
            // The ids are lost with the index; the files' names still say most.
            Paired(savedIds())
        }
        val failed = mutableListOf<String>()
        val computers = paired.ids.mapNotNull { id ->
            try {
                read<RemoteCredentials>(computer(id))
            } catch (_: Exception) {
                failed += id
                null
            }
        }
        unreadable = failed
        val ids = computers.map { it.key }
        LoadedPairings(Paired(ids, paired.active?.takeIf { it in ids } ?: ids.firstOrNull()), computers)
    }

    suspend fun savePaired(paired: Paired) = io {
        write(index, paired.copy(ids = paired.ids + unreadable.filter { it !in paired.ids }))
    }

    suspend fun saveCredentials(credentials: RemoteCredentials) = io {
        unreadable = unreadable - credentials.key
        write(computer(credentials.key), credentials)
    }

    suspend fun clearCredentials(id: String) = io {
        unreadable = unreadable - id
        computer(id).delete()
        Unit
    }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { lock.withLock { block() } }

    /** Null when there's no file; throws when there is one that won't open. */
    private inline fun <reified T> read(file: File): T? =
        if (!file.exists()) null
        else RemoteJson.decodeFromString<T>(box.open(file.readBytes()).toString(Charsets.UTF_8))

    private fun savedIds() = dir.listFiles().orEmpty().mapNotNull {
        Regex("^computer-([A-Za-z0-9_-]{1,100})\\.bin$").find(it.name)?.groupValues?.get(1)
    }.sorted()

    private inline fun <reified T> write(file: File, value: T) {
        dir.mkdirs()
        val tmp = File(dir, file.name + ".tmp")
        tmp.writeBytes(box.seal(RemoteJson.encodeToString(value).toByteArray(Charsets.UTF_8)))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}

/** Ids are base64url keys already; anything else is hashed into a name. */
internal fun fileSafe(id: String): String =
    if (Regex("^[A-Za-z0-9_-]{1,100}$").matches(id)) id
    else java.security.MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).joinToString("") { "%02x".format(it) }
