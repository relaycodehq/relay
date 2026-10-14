package dev.relay.android.remote.crypto

/**
 * RFC 4648 base64url without padding, decoding exactly as `shared/remote-crypto.ts`
 * does: any character outside the alphabet, or a length of 4n+1, is refused.
 */
object Base64Url {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    private val values = IntArray(128) { -1 }.also { v -> ALPHABET.forEachIndexed { i, c -> v[c.code] = i } }

    fun encode(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size * 4 + 2) / 3)
        var i = 0
        while (i < bytes.size) {
            val b0 = bytes[i].toInt() and 255
            val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 255 else 0
            val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 255 else 0
            val n = (b0 shl 16) or (b1 shl 8) or b2
            val count = minOf(4, ((bytes.size - i) * 8 + 5) / 6)
            for (j in 0 until count) out.append(ALPHABET[(n shr (18 - 6 * j)) and 63])
            i += 3
        }
        return out.toString()
    }

    /** Throws [IllegalArgumentException] on anything the TS decoder would refuse. */
    fun decode(text: String): ByteArray {
        require(text.length % 4 != 1) { "Invalid base64url." }
        val out = ByteArray(text.length * 6 / 8)
        var bits = 0
        var value = 0
        var at = 0
        for (c in text) {
            val v = if (c.code < 128) values[c.code] else -1
            require(v >= 0) { "Invalid base64url." }
            value = ((value shl 6) or v) and 0xffffff
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out[at++] = ((value shr bits) and 255).toByte()
            }
        }
        return out
    }

    fun decodeOrNull(text: String): ByteArray? = try {
        decode(text)
    } catch (_: IllegalArgumentException) {
        null
    }
}
