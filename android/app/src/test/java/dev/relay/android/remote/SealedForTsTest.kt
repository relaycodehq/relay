package dev.relay.android.remote

import dev.relay.android.remote.crypto.Base64Url
import dev.relay.android.remote.crypto.ClientHandshake
import dev.relay.android.remote.crypto.KeyPair
import dev.relay.android.remote.wire.WireData
import dev.relay.android.remote.wire.sealFrame
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Writes frames sealed by this client for /tmp/relay-vectors/vectors.ts to open with the
 * desktop's code. Deflate output isn't pinned byte for byte, so the TS side is the check.
 * Runs only with RELAY_VECTORS_OUT set.
 */
class SealedForTsTest {
    @Test fun `write client frames for the TS opener`() {
        val out = System.getenv("RELAY_VECTORS_OUT")
        assumeTrue(out != null)
        val v = Json.parseToJsonElement(TS_VECTORS).jsonObject
        fun fill(start: Int) = ByteArray(32) { (start + it).toByte() }
        val server = KeyPair.fromSecret(fill(1))
        val channel = ClientHandshake(server.public, KeyPair.fromSecret(fill(33))).finish(v["serverHello"]!!.jsonPrimitive.content)
        val big = v["bigJson"]!!.jsonPrimitive.content
        val frames = listOf(
            sealFrame(channel, """{"t":"auth","deviceId":"d","token":"t"}""", false),
            sealFrame(channel, """{"t":"call","id":1,"method":"overview","args":[]}""", true),
            sealFrame(channel, big, true),
        ).map {
            when (it) {
                is WireData.Text -> JsonPrimitive(it.text)
                is WireData.Binary -> JsonPrimitive("bin:" + Base64Url.encode(it.bytes))
            }
        }
        File(out!!).writeText(JsonArray(frames).toString())
    }
}
