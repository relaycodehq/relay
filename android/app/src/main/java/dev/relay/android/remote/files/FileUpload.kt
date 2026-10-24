package dev.relay.android.remote.files

import dev.relay.android.remote.client.Rejected
import dev.relay.android.remote.model.UploadedFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.RandomAccessFile
import java.util.Base64
import kotlin.coroutines.CoroutineContext

/** Where an upload goes: the computer's `uploadFile`. */
fun interface FileSink {
    suspend fun upload(id: String, name: String, size: Long, offset: Long, data: String): UploadedFile
}

private suspend fun read(file: File, range: LongRange, io: CoroutineContext): ByteArray = withContext(io) {
    if (!file.exists()) throw Rejected("${file.name} isn't on this phone anymore.")
    RandomAccessFile(file, "r").use { f ->
        val bytes = ByteArray((range.last - range.first + 1).toInt().coerceAtLeast(0))
        f.seek(range.first)
        f.readFully(bytes)
        bytes
    }
}

/**
 * Sends [file] to [computer] one chunk at a time until all of it is there,
 * always from where the computer says it got to: a lost answer, a reconnect
 * or another try carries on rather than starting over. [progress] hears each
 * step, to show it and keep it.
 */
suspend fun uploadFile(
    sink: FileSink,
    file: AttachedFile,
    computer: String,
    io: CoroutineContext = Dispatchers.IO,
    progress: (AttachedFile) -> Unit = {},
): AttachedFile {
    var at = file.on(computer)
    if (at !== file) progress(at)
    var stalled = 0
    while (at.path == null) {
        val range = nextChunk(at.received, at.size)
        val data = Base64.getEncoder().encodeToString(read(File(at.local), range, io))
        val answer = sink.upload(at.uploadId, at.name, at.size, range.first, data)
        // Behind is fine once (the computer lost a chunk); never getting further is not.
        stalled = if (answer.path == null && answer.received <= at.received) stalled + 1 else 0
        if (stalled > 1) throw IllegalStateException("The upload of ${at.name} got stuck.")
        at = at.copy(received = answer.received, path = answer.path)
        progress(at)
    }
    return at
}

/** Every file of a message to [computer], one after another. */
suspend fun uploadAll(
    sink: FileSink,
    files: List<AttachedFile>,
    computer: String,
    io: CoroutineContext = Dispatchers.IO,
    progress: (List<AttachedFile>) -> Unit = {},
): List<AttachedFile> {
    val now = files.toMutableList()
    for (i in now.indices) now[i] = uploadFile(sink, now[i], computer, io) { now[i] = it; progress(now.toList()) }
    return now
}

/** The phone's copies, gone once the computer has the message (or nobody wants them). */
fun deleteCopies(files: List<AttachedFile>) {
    for (f in files) runCatching {
        val copy = File(f.local)
        // Each copy has a folder of its own; see the composer's picking.
        val dir = copy.parentFile
        if (dir != null && dir.name.matches(Regex("[0-9a-f-]{36}"))) dir.deleteRecursively() else copy.delete()
    }
}

/** Where the composer keeps its copies, a folder each. */
fun copiesDir(filesDir: File) = File(filesDir, "relay-attachments")

/**
 * Drops the copies no kept send names: after a restart the composer holds
 * none of its own. Ones made from [before] on, picked as it runs, stay.
 */
fun sweepCopies(dir: File, kept: Collection<AttachedFile>, before: Long) {
    val named = kept.mapNotNull { File(it.local).parentFile?.canonicalPath }.toSet()
    dir.listFiles()?.forEach { if (it.canonicalPath !in named && it.lastModified() < before) it.deleteRecursively() }
}
