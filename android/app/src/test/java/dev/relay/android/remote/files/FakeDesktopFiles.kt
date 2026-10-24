package dev.relay.android.remote.files

import dev.relay.android.remote.model.UploadedFile
import java.io.ByteArrayOutputStream
import java.util.Base64

/** electron/drafts/uploads.ts in memory: skips what it has, ignores what's past it, names a whole file. */
class FakeDesktopFiles(private val folder: String = "/Users/me/Library/Application Support/Relay/pastes") : FileSink {
    val have = HashMap<String, ByteArrayOutputStream>()
    val done = HashMap<String, String>()
    var calls = 0
    /** Fails the call with this number (1-based) after taking its bytes, as a lost answer would. */
    var loseAnswerOf: Int? = null
    var refuse: Exception? = null

    override suspend fun upload(id: String, name: String, size: Long, offset: Long, data: String): UploadedFile {
        calls++
        refuse?.let { throw it }
        done[id]?.let { return UploadedFile(size, it) }
        val bytes = Base64.getDecoder().decode(data)
        val buf = have.getOrPut(id) { ByteArrayOutputStream() }
        val received = buf.size().toLong()
        if (offset <= received && offset + bytes.size > received)
            buf.write(bytes, (received - offset).toInt(), (offset + bytes.size - received).toInt())
        val now = buf.size().toLong()
        if (calls == loseAnswerOf) throw dev.relay.android.remote.client.Unanswered("Connection lost.")
        if (now < size) return UploadedFile(now)
        return UploadedFile(now, "$folder/$id/$name").also { done[id] = it.path!! }
    }

    fun bytes(id: String) = have[id]?.toByteArray()
}
