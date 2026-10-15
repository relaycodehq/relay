package dev.relay.android.remote.client

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.crypto.Channel
import dev.relay.android.remote.crypto.ClientHandshake
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.ServerFrame
import dev.relay.android.remote.tunnel.TunnelFrame
import dev.relay.android.remote.wire.Opened
import dev.relay.android.remote.wire.WireData
import dev.relay.android.remote.wire.openWire
import dev.relay.android.remote.wire.sealFrame
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What a [Dial] needs of its client. Everything runs on the client's own thread. */
internal interface DialOwner {
    val scope: CoroutineScope
    val sockets: SocketFactory
    /** How long a route gets to sign in. */
    val timeoutMs: Long
    val name: String
    fun post(block: () -> Unit)
    fun signInFrame(): JsonObject
    /** Whether [dial] carries the connection now. */
    fun isCurrent(dial: Dial): Boolean
    fun heard(dial: Dial)
    fun lost()
    fun tunnelFrame(frame: TunnelFrame)
    fun receive(frame: ServerFrame)
    fun warn(message: String, error: Throwable?)
}

internal interface DialHandlers {
    /** The channel is open; false leaves this route before it signs in. */
    fun signIn(dial: Dial): Boolean
    fun claim(dial: Dial, link: Link): Boolean
    fun failed(dial: Dial, error: Exception)
}

internal enum class DialState { Dialing, Won, Done }

internal class Link(val dial: Dial, val channel: Channel, val host: String, val frame: ServerFrame)

/** The first frame on a fresh channel: the pairing code, or the saved device's token. */
internal fun signInFrameOf(target: RemoteStart): JsonObject = when (target) {
    is RemoteStart.Pair -> buildJsonObject {
        put("t", "pair")
        put("code", target.link.code)
        put("device", target.device)
        target.kind?.let { put("kind", it) }
        put("bridge", Bridge.VERSION)
    }
    is RemoteStart.Saved -> buildJsonObject {
        put("t", "auth")
        put("deviceId", target.credentials.deviceId)
        put("token", target.credentials.token)
        put("bridge", Bridge.VERSION)
    }
}

/** One route: connects, opens the channel under the pinned key and signs in. */
internal class Dial(
    val host: String,
    port: Int,
    serverKey: ByteArray,
    private val owner: DialOwner,
    private val on: DialHandlers,
) {
    var state = DialState.Dialing
    private var detached = false
    private var channel: Channel? = null
    private val handshake = ClientHandshake(serverKey)
    private val timer: Job = owner.scope.launch {
        delay(owner.timeoutMs)
        fail(Exception("$host didn't answer."))
    }
    val socket: RemoteSocket = owner.sockets.open(
        "ws://${if (':' in host && !host.startsWith("[")) "[$host]" else host}:$port/",
        object : SocketListener {
            override fun onOpen() = owner.post { if (!detached) socket.send(WireData.Text(handshake.hello)) }
            override fun onMessage(data: WireData) = owner.post { if (!detached) message(data) }
            override fun onClosed() = owner.post { if (!detached) closedHere() }
        },
    )

    fun quit() {
        detached = true
        timer.cancel()
        try {
            socket.cancel()
        } catch (_: Exception) {
        }
    }

    fun cancel() {
        if (state != DialState.Dialing) return
        state = DialState.Done
        quit()
    }

    private fun fail(error: Exception) {
        if (state != DialState.Dialing) return
        state = DialState.Done
        quit()
        on.failed(this, error)
    }

    private fun closedHere() {
        if (state == DialState.Dialing) return fail(Exception("Can't reach ${owner.name}."))
        if (state == DialState.Won && owner.isCurrent(this)) owner.lost()
    }

    private fun message(data: WireData) {
        val opened: ServerFrame
        try {
            val open = channel
            if (open == null) {
                if (data !is WireData.Text) throw IllegalStateException("A binary hello.")
                val ready = handshake.finish(data.text)
                channel = ready
                if (!on.signIn(this)) {
                    state = DialState.Done
                    return quit()
                }
                // Sealed whole: nothing compact before the desktop says it reads it.
                socket.send(sealFrame(ready, owner.signInFrame().toString(), compact = false))
                return
            }
            val wire = openWire(open, data)
            if (wire is Opened.Tunnel) {
                if (state == DialState.Won && owner.isCurrent(this)) {
                    owner.heard(this)
                    owner.tunnelFrame(wire.frame)
                }
                return
            }
            val frame = RemoteJson.decodeFromString(ServerFrame.serializer(), (wire as Opened.Json).text)
            if (state == DialState.Dialing) {
                if (frame.t == "denied") return fail(Denied(frame.reason ?: "Relay said no."))
                if (frame.t != "paired" && frame.t != "ready") return fail(Exception("Unexpected answer from Relay."))
                timer.cancel()
                if (!on.claim(this, Link(this, open, host, frame))) {
                    state = DialState.Done
                    return quit()
                }
                state = DialState.Won
                return
            }
            if (state != DialState.Won) return
            owner.heard(this)
            opened = frame
        } catch (e: Exception) {
            // Anything that doesn't open under the pinned key isn't our desktop.
            if (state == DialState.Dialing) return fail(Exception("Couldn't verify ${owner.name}. Pair again."))
            if (owner.isCurrent(this)) owner.lost() else quit()
            return
        }
        // A listener's or a patch's failure is ours, not the desktop's: the link stays.
        try {
            owner.receive(opened)
        } catch (e: Exception) {
            owner.warn("Couldn't take in what ${owner.name} sent:", e)
        }
    }
}
