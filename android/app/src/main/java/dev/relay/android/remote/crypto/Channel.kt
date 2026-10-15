package dev.relay.android.remote.crypto

import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

/**
 * Sealed frames, one counter per direction: ChaCha20-Poly1305 (RFC 8439), no AAD,
 * nonce = 4 zero bytes + 64-bit big-endian counter. A frame out of order fails to open.
 * Not thread-safe; the client uses it from one coroutine at a time.
 */
class Channel(private val sendKey: ByteArray, private val receiveKey: ByteArray) {
    private var sent = 0L
    private var received = 0L

    fun seal(plain: ByteArray): ByteArray = aead(true, sendKey, sent++, plain)

    fun seal(plain: String): ByteArray = seal(plain.toByteArray(Charsets.UTF_8))

    /** Throws on a forged, reordered or replayed frame; the counter moves only on success. */
    fun openBytes(frame: ByteArray): ByteArray {
        val plain = aead(false, receiveKey, received, frame)
        received++
        return plain
    }

    fun open(frame: ByteArray): String = decodeUtf8Strict(openBytes(frame))

    private fun aead(encrypt: Boolean, key: ByteArray, counter: Long, input: ByteArray): ByteArray {
        val cipher = ChaCha20Poly1305()
        cipher.init(encrypt, AEADParameters(KeyParameter(key), 128, nonce(counter)))
        val out = ByteArray(cipher.getOutputSize(input.size))
        var n = cipher.processBytes(input, 0, input.size, out, 0)
        n += cipher.doFinal(out, n)
        return if (n == out.size) out else out.copyOf(n)
    }

    companion object {
        fun nonce(counter: Long): ByteArray =
            ByteBuffer.allocate(12).putInt(0).putLong(counter).array()
    }
}

/** UTF-8 that refuses malformed input, like `new TextDecoder("utf-8", { fatal: true })`. */
fun decodeUtf8Strict(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): String {
    val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
    val chars: CharBuffer = decoder.decode(ByteBuffer.wrap(bytes, offset, length))
    return chars.toString()
}
