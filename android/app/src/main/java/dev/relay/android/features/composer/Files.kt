package dev.relay.android.features.composer

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import dev.relay.android.features.composer.logic.FilePhase
import dev.relay.android.features.composer.logic.fileStatus
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.Rejected
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.uploadFile
import dev.relay.android.remote.files.AttachedFile
import dev.relay.android.remote.files.FILES_NEED_UPDATE
import dev.relay.android.remote.files.FILE_TOO_LARGE
import dev.relay.android.remote.files.FileSink
import dev.relay.android.remote.files.MAX_UPLOAD_BYTES
import dev.relay.android.remote.files.copiesDir
import dev.relay.android.remote.files.deleteCopies
import dev.relay.android.remote.files.uploadFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/** A video or file in a composer: being copied (a video compressed), going up, or ready. */
data class PickedFile(
    val key: String,
    val name: String,
    val video: Boolean,
    val phase: FilePhase,
    /** The phone's copy, once made. */
    val file: AttachedFile? = null,
    /** Its size before the copy's is known. */
    val size: Long? = null,
    /** Why it won't go: an older computer, too large. */
    val message: String? = null,
) {
    val status get() = fileStatus(phase, video, file?.size ?: size, file?.percent ?: 0)
}

private class TooLarge : Exception(FILE_TOO_LARGE)

private fun query(context: Context, uri: Uri): Pair<String?, Long?> = runCatching {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
        if (!it.moveToFirst()) null to null
        else (if (it.isNull(0)) null else it.getString(0)) to (if (it.isNull(1)) null else it.getLong(1))
    }
}.getOrNull() ?: (null to null)

private fun safeName(name: String) = name.replace(Regex("[/\\\\\\u0000]"), "_").trim().ifEmpty { "file" }

/** Copies [uri] into a folder of its own, at most [MAX_UPLOAD_BYTES]. */
private fun copy(context: Context, uri: Uri, to: File) {
    val input = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Relay can't read that file.")
    input.use { from ->
        to.outputStream().use { out ->
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = from.read(buffer)
                if (n < 0) break
                total += n
                if (total > MAX_UPLOAD_BYTES) throw TooLarge()
                out.write(buffer, 0, n)
            }
        }
    }
}

/**
 * The phone's copy of what was picked, which stays until the computer has
 * the message: a video compressed when that makes it smaller, anything else
 * as it is.
 */
private suspend fun prepare(context: Context, uri: Uri, video: Boolean): AttachedFile = withContext(Dispatchers.IO) {
    val (shown, size) = query(context, uri)
    val name = safeName(shown ?: if (video) "video.mp4" else "file")
    if (!video && size != null && size > MAX_UPLOAD_BYTES) throw TooLarge()
    val dir = File(copiesDir(context.filesDir), UUID.randomUUID().toString()).apply { mkdirs() }
    try {
        var made: File? = null
        if (video) {
            val out = File(dir, name.replace(Regex("\\.[^.]+$"), "") + ".mp4")
            try {
                compressVideo(context, uri, out)
                if (size == null || out.length() < size) made = out else out.delete()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // The video still goes, as it was.
                Log.w("Relay", "Couldn't compress a video", e)
                out.delete()
            }
        }
        val file = made ?: File(dir, name).also { copy(context, uri, it) }
        if (file.length() > MAX_UPLOAD_BYTES) throw TooLarge()
        AttachedFile(file.path, file.name, file.length())
    } catch (e: Throwable) {
        dir.deleteRecursively()
        throw e
    }
}

/** Why [files] can't go: one refused, or a [client] too old to take files. */
internal fun filesRefusal(files: List<PickedFile>, client: RemoteClient?): String? =
    files.firstOrNull { it.phase == FilePhase.Refused }?.message
        ?: FILES_NEED_UPDATE.takeIf { files.isNotEmpty() && client?.supports(Bridge.FILES) == false }

/**
 * The files composers picked, by key, for as long as the app runs (a draft's
 * [Unsent] holds the keys). Each is copied, then goes up to the computer at
 * once when it's online; a send hands what got there to the outbox, which
 * finishes the rest.
 */
internal object FileUploads {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _files = MutableStateFlow<Map<String, PickedFile>>(emptyMap())
    val files: StateFlow<Map<String, PickedFile>> = _files.asStateFlow()
    private val preparing = HashMap<String, Job>()
    private val uploading = HashMap<String, Job>()

    private fun set(key: String, change: (PickedFile) -> PickedFile) {
        val now = _files.value[key] ?: return
        _files.value = _files.value + (key to change(now))
    }

    /** Starts copying [uris]; their keys, for the draft. A copy that fails goes, telling [onError] why. */
    fun pick(context: Context, remote: Remote, uris: List<Uri>, video: Boolean, onError: (String) -> Unit): List<String> {
        val app = context.applicationContext
        return uris.map { uri ->
            val key = UUID.randomUUID().toString()
            val (shown, size) = query(app, uri)
            _files.value = _files.value + (key to PickedFile(key, shown ?: if (video) "video.mp4" else "file", video, FilePhase.Preparing, size = size))
            preparing[key] = scope.launch {
                try {
                    val file = prepare(app, uri, video)
                    set(key) { it.copy(name = file.name, phase = FilePhase.Ready, file = file) }
                    upload(key, remote)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: TooLarge) {
                    set(key) { it.copy(phase = FilePhase.Refused, message = FILE_TOO_LARGE) }
                    onError(FILE_TOO_LARGE)
                } catch (e: SecurityException) {
                    _files.value = _files.value - key
                    onError("Relay isn't allowed to read that file.")
                } catch (e: Exception) {
                    _files.value = _files.value - key
                    onError(e.message ?: e.toString())
                } finally {
                    preparing.remove(key)
                }
            }
            key
        }
    }

    /** Sends it up while the computer is there; offline, the send's outbox does it later. */
    fun upload(key: String, remote: Remote) {
        val picked = _files.value[key] ?: return
        val file = picked.file ?: return
        val client = remote.client.value
        val computer = remote.active.value
        if (client == null || computer == null || remote.status.value.state != LinkState.Online) return
        if (!client.supports(Bridge.FILES)) {
            set(key) { it.copy(phase = FilePhase.Refused, message = FILES_NEED_UPDATE) }
            return
        }
        if (file.path != null && file.computer == computer) return
        uploading[key]?.cancel()
        set(key) { it.copy(phase = FilePhase.Uploading) }
        val job = scope.launch {
            try {
                val done = uploadFile(FileSink(client::uploadFile), file, computer) { now -> set(key) { it.copy(file = now) } }
                set(key) { it.copy(phase = FilePhase.Ready, file = done) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Rejected) {
                set(key) { it.copy(phase = FilePhase.Refused, message = e.message) }
            } catch (e: Exception) {
                set(key) { it.copy(phase = FilePhase.Failed) }
            }
        }
        uploading[key] = job
        job.invokeOnCompletion { scope.launch { if (uploading[key] === job) uploading.remove(key) } }
    }

    fun retry(key: String, remote: Remote) {
        if (_files.value[key]?.phase == FilePhase.Failed) upload(key, remote)
    }

    /** Taken out of the draft: its copy goes too. */
    fun remove(key: String) {
        preparing.remove(key)?.cancel()
        uploading.remove(key)?.cancel()
        _files.value[key]?.file?.let { deleteCopies(listOf(it)) }
        _files.value = _files.value - key
    }

    /** Waits for [keys]' copies to be made. */
    suspend fun prepared(keys: List<String>) {
        for (key in keys) preparing[key]?.join()
    }

    /** What [keys] got to so far, for a send: their uploads stop here, as the outbox carries on with them. */
    fun take(keys: List<String>): List<AttachedFile> = keys.mapNotNull { key ->
        uploading.remove(key)?.cancel()
        set(key) { if (it.phase == FilePhase.Uploading) it.copy(phase = FilePhase.Ready) else it }
        _files.value[key]?.file
    }

    /** Sent: the outbox has them now, copies and all. */
    fun forget(keys: List<String>) {
        _files.value = _files.value - keys.toSet()
    }

    /** A taken-back send's files, back in a composer. */
    fun restore(files: List<AttachedFile>): List<String> = files.map { file ->
        val key = UUID.randomUUID().toString()
        _files.value = _files.value + (key to PickedFile(key, file.name, file.name.endsWith(".mp4"), FilePhase.Ready, file))
        key
    }
}
