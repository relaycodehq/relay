package dev.relay.android.remote

import dev.relay.android.remote.crypto.Base64Url
import dev.relay.android.remote.crypto.Channel
import dev.relay.android.remote.crypto.ClientHandshake
import dev.relay.android.remote.crypto.HandshakeException
import dev.relay.android.remote.crypto.KeyPair
import dev.relay.android.remote.crypto.ServerHandshake
import dev.relay.android.remote.crypto.derive
import dev.relay.android.remote.crypto.dh
import dev.relay.android.remote.crypto.helloKey
import dev.relay.android.remote.wire.WireData
import dev.relay.android.remote.wire.openFrame
import dev.relay.android.remote.wire.sealFrame
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** The Kotlin port against what the TypeScript bridge produced (TsVectors). */
class CrossImplementationTest {
    private val v = Json.parseToJsonElement(TS_VECTORS).jsonObject
    private fun str(key: String) = v[key]!!.jsonPrimitive.content
    private fun fill(start: Int) = ByteArray(32) { (start + it).toByte() }
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    private val server = KeyPair.fromSecret(fill(1))
    private val client = KeyPair.fromSecret(fill(33))
    private val serverEphemeral = KeyPair.fromSecret(fill(65))

    private fun channel(): Channel = ClientHandshake(server.public, client).finish(str("serverHello"))

    @Test fun `public keys and hellos match`() {
        assertEquals(str("serverStaticPub"), Base64Url.encode(server.public))
        assertEquals(str("clientHello"), ClientHandshake(server.public, client).hello)
        assertEquals(str("serverHello"), ServerHandshake(server, str("clientHello"), serverEphemeral).hello)
    }

    @Test fun `session keys match`() {
        val keys = derive(
            dh(client.secret, server.public), dh(client.secret, serverEphemeral.public),
            server.public, client.public, serverEphemeral.public,
        )
        assertEquals(str("toServer"), hex(keys.toServer))
        assertEquals(str("toClient"), hex(keys.toClient))
    }

    @Test fun `seals at counters 0 and 1 match`() {
        val c = channel()
        assertEquals(str("clientSeal0"), hex(c.seal("hello relay")))
        assertEquals(str("clientSeal1"), hex(c.seal("hello relay")))
    }

    @Test fun `frames the desktop sealed open here, text and compact, node zlib and fflate`() {
        val c = channel()
        val frames = v["serverFrames"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(
            """{"t":"ready","name":"Mac","bridge":21,"hosts":["192.168.1.2","100.100.1.1"]}""",
            openFrame(c, WireData.Text(frames[0])),
        )
        assertEquals("""{"t":"tick"}""", openFrame(c, WireData.Binary(Base64Url.decode(frames[1]))))
        assertEquals(str("bigJson"), openFrame(c, WireData.Binary(Base64Url.decode(frames[2]))))
        assertEquals(str("bigJson"), openFrame(c, WireData.Binary(Base64Url.decode(frames[3]))))
    }

    @Test fun `server side opens what the client seals, compact and deflated too`() {
        val clientSide = ClientHandshake(server.public, client)
        val serverSide = ServerHandshake(server, clientSide.hello, serverEphemeral)
        val c = clientSide.finish(serverSide.hello)
        val big = str("bigJson")
        for ((json, compact) in listOf("""{"t":"got","s":1}""" to false, """{"t":"got","s":2}""" to true, big to true)) {
            assertEquals(json, openFrame(serverSide.channel, sealFrame(c, json, compact)))
        }
        val packed = sealFrame(c, big, true) as WireData.Binary
        // Deflated: far smaller than the 3 KB of JSON.
        assert(packed.bytes.size < big.length / 2)
    }

    @Test fun `base64url matches, and refuses padding and stray characters`() {
        for (pair in v["b64"]!!.jsonArray) {
            val (h, b) = pair.jsonArray.map { it.jsonPrimitive.content }
            val bytes = Base64Url.decode(b)
            assertEquals(h, hex(bytes))
            assertEquals(b, Base64Url.encode(bytes))
        }
        for (bad in listOf("AA==", "AA=", "A", "AA+", "AA/", "AA E")) assertThrows(IllegalArgumentException::class.java) { Base64Url.decode(bad) }
    }

    @Test fun `an all-zero shared secret is refused`() {
        assertThrows(HandshakeException::class.java) { dh(client.secret, ByteArray(32)) }
    }

    @Test fun `a hello that isn't protocol 1 is refused`() {
        val e = Base64Url.encode(client.public)
        for (bad in listOf(
            """{"t":"hello","v":"1","e":"$e"}""",
            """{"t":"hello","v":2,"e":"$e"}""",
            """{"t":"hi","v":1,"e":"$e"}""",
            """{"t":"hello","v":1,"e":"AAAA"}""",
        )) assertThrows(Exception::class.java) { helloKey(bad) }
        assertArrayEquals(client.public, helloKey("""{"t":"hello","v":1,"e":"$e"}"""))
    }

    @Test fun `a tampered frame or a replay doesn't open`() {
        val clientSide = ClientHandshake(server.public, client)
        val serverSide = ServerHandshake(server, clientSide.hello, serverEphemeral)
        val c = clientSide.finish(serverSide.hello)
        val sealed = c.seal("one")
        val tampered = sealed.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertThrows(Exception::class.java) { serverSide.channel.open(tampered) }
        assertEquals("one", serverSide.channel.open(sealed))
        assertThrows(Exception::class.java) { serverSide.channel.open(sealed) }
    }
}
