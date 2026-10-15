package dev.relay.android.features.updates

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.SecureRandom
import java.util.Base64

/** shared/phone-release.test.ts, plus the applicationId gate this app adds. */
class UpdateFeedTest {
    private val private = Ed25519PrivateKeyParameters(SecureRandom())
    private val key = Base64.getEncoder().encodeToString(private.generatePublicKey().encoded)
    private val me = "dev.relay.android"

    private val apk = buildJsonObject {
        put("name", "Relay-Android.apk")
        put("url", "https://github.com/relaycodehq/relay/releases/download/v0.10.2/Relay-Android.apk")
        put("sha512", "A".repeat(86) + "==")
        put("size", 57_000_000)
        put("version", "0.10.0")
        put("runtime", "abc")
    }

    private fun with(o: JsonObject, vararg more: Pair<String, JsonElement>) = JsonObject(o + more)
    private fun str(s: String) = kotlinx.serialization.json.JsonPrimitive(s)

    /** Serves `feed` as latest.json, signed by the test key unless `signature` says otherwise. */
    private fun serve(feed: JsonObject, signature: String? = "sign"): suspend (String) -> FeedResponse {
        val bytes = (Json { prettyPrint = true }.encodeToString(JsonElement.serializer(), feed) + "\n").toByteArray()
        val sig = if (signature == "sign") {
            val s = Ed25519Signer().apply { init(true, private); update(bytes, 0, bytes.size) }
            Base64.getEncoder().encodeToString(s.generateSignature())
        } else signature
        return { url ->
            val body = if (url.endsWith(".sig")) sig?.toByteArray() else bytes
            FeedResponse(body != null, if (body == null) 404 else 200, body ?: ByteArray(0))
        }
    }

    private fun feed(vararg entries: Pair<String, JsonElement>) =
        JsonObject(mapOf("version" to str("0.10.2"), "files" to JsonObject(emptyMap())) + entries)

    private fun fails(pattern: String, block: suspend () -> Unit) = runBlocking {
        try {
            block()
            fail("expected a failure matching $pattern")
        } catch (e: FeedException) {
            assertTrue(e.message!!, Regex(pattern).containsMatchIn(e.message!!))
        }
    }

    @Test fun takesTheApkBesideTheDesktopsFilesWithItsOwnVersion() = runBlocking {
        val newest = fetchNewestApp(serve(feed("android" to apk)), me, keys = listOf(key))
        assertEquals(
            NewestApp("0.10.2", "0.10.0", apk["url"].toString().trim('"'), "abc", "A".repeat(86) + "==", 57_000_000),
            newest,
        )
    }

    @Test fun fallsBackToTheReleasesOwnApkForOldFeeds() = runBlocking {
        val newest = fetchNewestApp(serve(JsonObject(mapOf("version" to str("0.9.1")))), me, keys = listOf(key))
        assertEquals(
            NewestApp("0.9.1", "0.9.1", "https://github.com/relaycodehq/relay/releases/download/v0.9.1/Relay-Android.apk"),
            newest,
        )
    }

    @Test fun refusesAFeedThatIsNotSignedByAPinnedKey() {
        val f = feed("android" to apk)
        fails("answered 404") { fetchNewestApp(serve(f, null), me, keys = listOf(key)) }
        fails("doesn't check out") { fetchNewestApp(serve(f, "A".repeat(86) + "=="), me, keys = listOf(key)) }
        fails("doesn't check out") { fetchNewestApp(serve(f), me) }
    }

    @Test fun refusesAnApkOnPlainHttpEvenWhenSigned() {
        fails("can't read") {
            fetchNewestApp(serve(feed("android" to with(apk, "url" to str("http://github.com/x.apk")))), me, keys = listOf(key))
        }
        fails("can't read") {
            fetchNewestApp(serve(feed("android" to with(apk, "url" to str("http://127.0.0.1/Relay.apk")))), me, keys = listOf(key))
        }
        fails("can't read") { fetchNewestApp(serve(feed("android" to with(apk, "size" to str("57")))), me, keys = listOf(key)) }
    }

    @Test fun prefersAnEntryForThisAppsId() = runBlocking {
        val native = with(apk, "version" to str("0.2.0"), "applicationId" to str(me), "url" to str("https://example.test/native.apk"))
        val newest = fetchNewestApp(serve(feed("android" to apk, "androidNative" to native)), me, keys = listOf(key))
        assertEquals("0.2.0", newest.version)
        assertTrue(newest.installableBy(me))
        // The Expo app still reads its own entry from the same feed.
        val expo = parseFeed(serve(feed("android" to apk, "androidNative" to native)).let { runBlocking { it("x").body } }, "dev.relay.remote")
        assertEquals("0.10.0", expo.version)
    }

    @Test fun anEntryWithoutAnIdIsTheExpoAppsAndNotInstallableHere() {
        val newest = parseFeed(runBlocking { serve(feed("android" to apk))("x").body }, me)
        assertFalse(newest.installableBy(me))
        val mine = parseFeed(runBlocking { serve(feed("android" to with(apk, "applicationId" to str(me))))("x").body }, me)
        assertTrue(mine.installableBy(me))
    }

    @Test fun offersOnlyANewerApk() {
        fun app(v: String) = NewestApp(v, v, "https://x.test/a.apk")
        assertTrue(offersNewer(app("0.10.0"), "0.9.1", "0.9.1"))
        assertFalse(offersNewer(app("0.9.1"), "0.9.1", "0.9.1"))
        assertFalse(offersNewer(app("0.9.0"), "0.9.1", "0.9.1"))
        assertFalse(offersNewer(null, "0.9.1", "0.9.1"))
        assertFalse(offersNewer(app("0.10.0"), "0.9.1", "0.10.3"))
    }
}
