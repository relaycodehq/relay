package dev.relay.android.features.updates

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.math.ec.rfc8032.Ed25519
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import java.util.Base64

/** shared/update-signature.test.ts, plus the live 0.12.0 feed as a vector signed by the pinned key. */
class UpdateSignatureTest {
    private class Pair(val private: Ed25519PrivateKeyParameters) {
        val key: String = Base64.getEncoder().encodeToString(private.generatePublicKey().encoded)
        fun sign(bytes: ByteArray): String {
            val s = Ed25519Signer().apply { init(true, private); update(bytes, 0, bytes.size) }
            return Base64.getEncoder().encodeToString(s.generateSignature())
        }
    }

    private fun keyPair() = Pair(Ed25519PrivateKeyParameters(SecureRandom()))

    private val feed = "{\n  \"version\": \"0.9.0\",\n  \"files\": {}\n}\n".toByteArray()
    private val release = keyPair()
    private val signature = release.sign(feed)

    @Test fun acceptsTheReleaseKeysSignatureOverTheExactBytes() {
        assertTrue(signedByAny(feed, signature, listOf(release.key)))
        assertTrue(signedByAny(feed, "$signature\n", listOf(release.key)))
    }

    @Test fun refusesAFeedWithAnyByteChanged() {
        val tampered = feed.copyOf().also { it[it.indexOf('9'.code.toByte())] = '8'.code.toByte() }
        assertFalse(signedByAny(tampered, signature, listOf(release.key)))
        val reformatted = "{\"version\":\"0.9.0\",\"files\":{}}".toByteArray()
        assertFalse(signedByAny(reformatted, signature, listOf(release.key)))
    }

    @Test fun refusesASignatureByAKeyThatIsNotPinned() {
        val forged = keyPair().sign(feed)
        assertFalse(signedByAny(feed, forged, listOf(release.key)))
        assertFalse(signedByAny(feed, signature, emptyList()))
    }

    @Test fun acceptsAnyKeyOnTheListAndASigFileSignedByBoth() {
        val next = keyPair()
        assertTrue(signedByAny(feed, next.sign(feed), listOf(release.key, next.key)))
        val both = "${next.sign(feed)}\n$signature\n"
        assertTrue(signedByAny(feed, both, listOf(release.key)))
        assertTrue(signedByAny(feed, both, listOf(next.key)))
        assertFalse(signedByAny(feed, both, listOf(keyPair().key)))
    }

    @Test fun refusesAnEmptyTruncatedOrMalformedSignature() {
        for (bad in listOf("", "not a signature", signature.take(40), "A".repeat(86) + "=="))
            assertFalse(bad, signedByAny(feed, bad, listOf(release.key)))
        assertFalse(signedByAny(feed, signature, listOf("not-a-key")))
    }

    @Test fun pinsWellFormedKeys() {
        assertTrue(Releases.keys.isNotEmpty())
        for (key in Releases.keys) {
            val raw = Base64.getDecoder().decode(key)
            assertEquals(key, Base64.getEncoder().encodeToString(raw))
            assertEquals(32, raw.size)
            assertTrue(Ed25519.validatePublicKeyFull(raw, 0))
        }
    }

    @Test fun verifiesTheRealReleaseFeedWithThePinnedKey() {
        val body = resource("latest.json")
        val sig = resource("latest.json.sig").decodeToString()
        assertTrue(signedByAny(body, sig, Releases.keys))
        assertFalse(signedByAny(body + '\n'.code.toByte(), sig, Releases.keys))
    }

    @Test fun readsTheRealFeedAsTheExpoAppsApk() {
        val newest = parseFeed(resource("latest.json"), "dev.relay.android")
        assertEquals("0.12.0", newest.release)
        assertEquals("0.12.0", newest.version)
        assertEquals(null, newest.applicationId)
        assertFalse(newest.installableBy("dev.relay.android"))
        assertTrue(newest.installableBy("dev.relay.remote"))
    }

    private fun resource(name: String) =
        requireNotNull(javaClass.classLoader!!.getResourceAsStream("updates/$name")) { name }.readBytes()
}
