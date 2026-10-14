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
 * a file sealed by [box]. A file that won't open counts as missing.
 */
class CredentialStore(private val dir: File, private val box: SecretBox = KeystoreBox()) {
    private val lock = Mutex()
    private val index get() = File(dir, "computers.bin")
    private fun computer(id: String) = File(dir, "computer-${fileSafe(id)}.bin")

    suspend fun load(): LoadedPairings = io {
        val paired = read<Paired>(index) ?: Paired()
        val computers = paired.ids.mapNotNull { read<RemoteCredentials>(computer(it)) }
        val ids = computers.map { it.key }
        LoadedPairings(Paired(ids, paired.active?.takeIf { it in ids } ?: ids.firstOrNull()), computers)
    }

    suspend fun savePaired(paired: Paired) = io { write(index, paired) }

    suspend fun saveCredentials(credentials: RemoteCredentials) = io { write(computer(credentials.key), credentials) }

    suspend fun clearCredentials(id: String) = io { computer(id).delete(); Unit }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { lock.withLock { block() } }

    private inline fun <reified T> read(file: File): T? = try {
        if (!file.exists()) null
        else RemoteJson.decodeFromString<T>(box.open(file.readBytes()).toString(Charsets.UTF_8))
    } catch (_: Exception) {
        null
    }

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
