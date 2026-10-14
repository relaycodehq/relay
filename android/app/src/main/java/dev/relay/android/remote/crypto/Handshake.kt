package dev.relay.android.remote.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.math.ec.rfc7748.X25519
import java.security.SecureRandom

/** The bridge's protocol (`remoteProtocol`); a hello with any other `v` is refused. */
const val REMOTE_PROTOCOL = 1

private val salt = "relay-remote/1".toByteArray(Charsets.UTF_8)

class KeyPair(val secret: ByteArray, val public: ByteArray) {
    companion object {
        fun generate(random: SecureRandom = SecureRandom()): KeyPair {
            val secret = ByteArray(X25519.SCALAR_SIZE).also(random::nextBytes)
            return KeyPair(secret, publicKeyOf(secret))
        }

        fun fromSecret(secret: ByteArray) = KeyPair(secret.copyOf(), publicKeyOf(secret))
    }
}

fun publicKeyOf(secret: ByteArray): ByteArray {
    require(secret.size == X25519.SCALAR_SIZE)
    return ByteArray(X25519.POINT_SIZE).also { X25519.scalarMultBase(secret, 0, it, 0) }
}

class HandshakeException(message: String) : Exception(message)

/** X25519, refusing the all-zero secret a low-order peer key gives. */
internal fun dh(secret: ByteArray, peer: ByteArray): ByteArray {
    val shared = ByteArray(X25519.POINT_SIZE)
    if (peer.size != X25519.POINT_SIZE || !X25519.calculateAgreement(secret, 0, peer, 0, shared, 0) ||
        shared.all { it == 0.toByte() }
    ) throw HandshakeException("Invalid key exchange.")
    return shared
}

class SessionKeys(val toServer: ByteArray, val toClient: ByteArray)

/** HKDF-SHA256(es || ee, "relay-remote/1", serverStatic || clientEphemeral || serverEphemeral, 64). */
internal fun derive(
    es: ByteArray,
    ee: ByteArray,
    serverStatic: ByteArray,
    clientEphemeral: ByteArray,
    serverEphemeral: ByteArray,
): SessionKeys {
    val okm = ByteArray(64)
    HKDFBytesGenerator(SHA256Digest()).apply {
        init(HKDFParameters(es + ee, salt, serverStatic + clientEphemeral + serverEphemeral))
        generateBytes(okm, 0, 64)
    }
    return SessionKeys(okm.copyOfRange(0, 32), okm.copyOfRange(32, 64))
}

fun helloFrame(key: ByteArray): String = buildJsonObject {
    put("t", "hello")
    put("v", REMOTE_PROTOCOL)
    put("e", Base64Url.encode(key))
}.toString()

/** The ephemeral key in a peer's hello; throws on anything else. */
fun helloKey(text: String): ByteArray {
    val frame = try {
        Json.parseToJsonElement(text) as? JsonObject
    } catch (_: Exception) {
        null
    }
    val t = frame?.get("t") as? JsonPrimitive
    val v = frame?.get("v") as? JsonPrimitive
    if (t == null || !t.isString || t.content != "hello" || v == null || v.isString || v.doubleOrNull != REMOTE_PROTOCOL.toDouble())
        throw HandshakeException("This Relay speaks a different remote protocol.")
    val e = (frame["e"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw HandshakeException("Invalid key exchange.")
    val key = Base64Url.decodeOrNull(e) ?: throw HandshakeException("Invalid key exchange.")
    if (key.size != 32) throw HandshakeException("Invalid key exchange.")
    return key
}

/** The phone's side: send [hello], then [finish] with the desktop's reply. */
class ClientHandshake(private val serverKey: ByteArray, private val ephemeral: KeyPair = KeyPair.generate()) {
    val hello: String = helloFrame(ephemeral.public)

    fun finish(reply: String): Channel {
        val serverEphemeral = helloKey(reply)
        val keys = derive(
            dh(ephemeral.secret, serverKey),
            dh(ephemeral.secret, serverEphemeral),
            serverKey,
            ephemeral.public,
            serverEphemeral,
        )
        return Channel(keys.toServer, keys.toClient)
    }
}

/** The desktop's side, for tests and a stand-in desktop. */
class ServerHandshake(staticKey: KeyPair, clientHello: String, ephemeral: KeyPair = KeyPair.generate()) {
    val hello: String = helloFrame(ephemeral.public)
    val channel: Channel

    init {
        val clientEphemeral = helloKey(clientHello)
        val keys = derive(
            dh(staticKey.secret, clientEphemeral),
            dh(ephemeral.secret, clientEphemeral),
            staticKey.public,
            clientEphemeral,
            ephemeral.public,
        )
        channel = Channel(keys.toClient, keys.toServer)
    }
}
