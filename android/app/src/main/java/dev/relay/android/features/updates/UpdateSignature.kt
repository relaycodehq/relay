package dev.relay.android.features.updates

import org.bouncycastle.math.ec.rfc8032.Ed25519
import java.util.Base64

private val base64Signature = Regex("^[A-Za-z0-9+/]{86}==$")

private fun fromBase64(text: String): ByteArray = try {
    Base64.getDecoder().decode(text.trimEnd('='))
} catch (_: IllegalArgumentException) {
    ByteArray(0)
}

/**
 * shared/update-signature's signedByAny: true when one of the lines in
 * `signatures` (base64, as latest.json.sig holds them) is an Ed25519 signature
 * over exactly `feed` by one of `keys` (raw public keys, base64). Several lines
 * let a key rotation sign with both keys.
 */
fun signedByAny(feed: ByteArray, signatures: String, keys: List<String>): Boolean {
    val sigs = signatures.split(Regex("\\s+"))
        .filter { base64Signature.matches(it) }
        .take(8)
        .map(::fromBase64)
        .filter { it.size == Ed25519.SIGNATURE_SIZE }
    val raws = keys.map(::fromBase64).filter { it.size == Ed25519.PUBLIC_KEY_SIZE }
    return sigs.any { sig ->
        raws.any { raw ->
            // BouncyCastle's verify is strict RFC 8032 (canonical S, cofactorless), as OpenSSL signs and checks.
            try {
                Ed25519.verify(sig, 0, raw, 0, feed, 0, feed.size)
            } catch (_: Exception) {
                false
            }
        }
    }
}
