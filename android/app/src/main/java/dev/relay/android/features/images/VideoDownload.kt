package dev.relay.android.features.images

import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** A piece of an answer's video as `projectChatVideoPart` returns it (shared/answer-images VideoPart). */
class VideoPart(val size: Long, val data: String)

/** Bigger than this, a video isn't worth pulling to the phone. */
const val MAX_VIDEO_BYTES = 500L * 1024 * 1024

class VideoTooBig(val size: Long) : Exception("The video is too big to play here.")

/**
 * Answer videos downloaded from the computer, since the phone can't stream
 * them from there: one file per computer, answer and path, in [dir], the
 * least recently played going first once they take more than [keepBytes].
 */
class VideoFiles(private val dir: File, private val keepBytes: Long = 1024L * 1024 * 1024) {
    private val locks = ConcurrentHashMap<String, Mutex>()

    fun fileFor(key: String, path: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
        val name = digest.joinToString("") { "%02x".format(it) }.take(32)
        val extension = path.substringAfterLast('.', "mp4").lowercase()
        return File(dir, "$name.$extension")
    }

    /** The video's file here, downloading it first if it isn't yet; [progress] hears bytes so far of all. */
    suspend fun download(
        key: String,
        path: String,
        fetch: suspend (offset: Long) -> VideoPart,
        progress: (done: Long, size: Long) -> Unit = { _, _ -> },
    ): File = locks.getOrPut(key) { Mutex() }.withLock {
        val target = fileFor(key, path)
        withContext(Dispatchers.IO) {
            if (target.exists()) {
                target.setLastModified(System.currentTimeMillis())
                return@withContext target
            }
            dir.mkdirs()
            // A part left by a download that was cut off may be of an older file; start over.
            val part = File(target.path + ".part").apply { delete() }
            var done = 0L
            while (true) {
                val piece = fetch(done)
                if (piece.size > MAX_VIDEO_BYTES) throw VideoTooBig(piece.size)
                val bytes = Base64.getDecoder().decode(piece.data)
                FileOutputStream(part, true).use { it.write(bytes) }
                done += bytes.size
                progress(done, piece.size)
                if (done >= piece.size) break
                if (bytes.isEmpty()) error("The video ended before its size.")
            }
            if (!part.renameTo(target)) error("Couldn't keep the video.")
            trim(except = target)
            target
        }
    }

    private fun trim(except: File) {
        val files = dir.listFiles { file -> file.isFile && !file.name.endsWith(".part") }.orEmpty()
            .sortedByDescending { it.lastModified() }
        var kept = 0L
        for (file in files) {
            kept += file.length()
            if (kept > keepBytes && file != except) file.delete()
        }
    }
}
