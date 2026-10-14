package dev.relay.android.remote.wire

import dev.relay.android.remote.crypto.Base64Url
import dev.relay.android.remote.crypto.Channel
import dev.relay.android.remote.crypto.decodeUtf8Strict
import java.io.ByteArrayOutputStream
import java.util.zip.Deflater
import java.util.zip.Inflater

/** One WebSocket frame: base64url text before compact mode, sealed bytes after. */
sealed interface WireData {
    data class Text(val text: String) : WireData
    class Binary(val bytes: ByteArray) : WireData
}

/** Raw DEFLATE, as fflate and node:zlib's `deflateRawSync` speak it. */
object Codec {
    /** Above this it's photos, which barely shrink, at the phone's CPU. */
    const val DEFLATE_UP_TO = 1024 * 1024
    const val DEFLATE_FROM = 256
    const val INFLATE_CAP = 32 * 1024 * 1024

    fun deflate(bytes: ByteArray): ByteArray {
        val deflater = Deflater(6, true)
        try {
            deflater.setInput(bytes)
            deflater.finish()
            val out = ByteArrayOutputStream(bytes.size / 2 + 64)
            val buf = ByteArray(16 * 1024)
            while (!deflater.finished()) out.write(buf, 0, deflater.deflate(buf))
            return out.toByteArray()
        } finally {
            deflater.end()
        }
    }

    fun inflate(bytes: ByteArray, cap: Int = INFLATE_CAP): ByteArray {
        val inflater = Inflater(true)
        try {
            inflater.setInput(bytes)
            val out = ByteArrayOutputStream(bytes.size * 4)
            val buf = ByteArray(64 * 1024)
            while (!inflater.finished()) {
                val n = inflater.inflate(buf)
                if (n == 0 && (inflater.needsInput() || inflater.needsDictionary()))
                    throw IllegalArgumentException("Truncated frame.")
                if (out.size() + n > cap) throw IllegalArgumentException("Frame too large.")
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        } finally {
            inflater.end()
        }
    }
}

private const val RAW: Byte = 0
private const val DEFLATED: Byte = 1

/** `sealFrame`: text = base64url(seal(json)); compact = seal(flag || json or deflate(json)). */
fun sealFrame(channel: Channel, json: String, compact: Boolean): WireData {
    if (!compact) return WireData.Text(Base64Url.encode(channel.seal(json)))
    val bytes = json.toByteArray(Charsets.UTF_8)
    var flag = RAW
    var body = bytes
    if (bytes.size >= Codec.DEFLATE_FROM && bytes.size <= Codec.DEFLATE_UP_TO) {
        val packed = Codec.deflate(bytes)
        if (packed.size < bytes.size) {
            flag = DEFLATED
            body = packed
        }
    }
    val plain = ByteArray(body.size + 1)
    plain[0] = flag
    System.arraycopy(body, 0, plain, 1, body.size)
    return WireData.Binary(channel.seal(plain))
}

/** `openFrame`: the JSON text inside. Throws on anything that doesn't open or has an unknown flag. */
fun openFrame(channel: Channel, data: WireData): String = when (data) {
    is WireData.Text -> channel.open(Base64Url.decode(data.text))
    is WireData.Binary -> {
        val plain = channel.openBytes(data.bytes)
        if (plain.isEmpty()) throw IllegalArgumentException("Unknown frame.")
        when (plain[0]) {
            RAW -> decodeUtf8Strict(plain, 1)
            DEFLATED -> decodeUtf8Strict(Codec.inflate(plain.copyOfRange(1, plain.size)))
            else -> throw IllegalArgumentException("Unknown frame.")
        }
    }
}
