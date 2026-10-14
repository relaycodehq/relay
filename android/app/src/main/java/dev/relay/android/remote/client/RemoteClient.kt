package dev.relay.android.remote.client

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.PairingLink
import dev.relay.android.remote.RouteKind
import dev.relay.android.remote.Routes
import dev.relay.android.remote.crypto.Base64Url
import dev.relay.android.remote.crypto.Channel
import dev.relay.android.remote.crypto.ClientHandshake
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteCredentials
import dev.relay.android.remote.model.RemoteEvent
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.ServerFrame
import dev.relay.android.remote.tunnel.TunnelFrame
import dev.relay.android.remote.tunnel.TunnelStreams
import dev.relay.android.remote.validHost
import dev.relay.android.remote.wire.Opened
import dev.relay.android.remote.wire.WireData
import dev.relay.android.remote.wire.openWire
import dev.relay.android.remote.wire.sealFrame
import dev.relay.android.remote.wire.sealTunnel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

enum class LinkState { Connecting, Online, Offline, Denied }

data class RemoteStatus(val state: LinkState, val detail: String? = null)

/** How a client starts: trading a pairing code, or signing in with saved credentials. */
sealed interface RemoteStart {
    data class Pair(val link: PairingLink, val device: String, val kind: String? = null) : RemoteStart
    data class Saved(val credentials: RemoteCredentials) : RemoteStart
}

data class RemoteRoute(val host: String, val kind: RouteKind)

data class RemoteClientOptions(
    /** Per host while connecting, and per call. */
    val timeoutMs: Long = 15_000,
    /** How long one route gets before the next is tried beside it. */
    val staggerMs: Long = 1_500,
    /** How often a link on a later route looks for an earlier one. */
    val betterRouteMs: Long = 60_000,
    /** Per call for the slow method lists. */
    val slowTimeoutMs: Long = 120_000,
    /** Silence after which a link counts as dead; the desktop ticks every 15s. */
    val staleMs: Long = 40_000,
    /** A route that lost to the current one isn't tried again for this long. */
    val worseCooldownMs: Long = 5 * 60_000,
)

/** Called on the client's own thread. */
interface RemoteClientListener {
    fun onStatus(status: RemoteStatus) {}
    fun onEvent(event: RemoteEvent) {}
    /** First contact traded the pairing code for these; keep them to reconnect. */
    fun onPaired(credentials: RemoteCredentials) {}
    /** The desktop named new addresses, or the route order changed; keep these instead. */
    fun onCredentials(credentials: RemoteCredentials) {}
}

open class RemoteCallException(message: String) : Exception(message)
class NotConnected(message: String) : RemoteCallException(message)
/** The call went out but no answer came back: the desktop may have done it all the same. */
class Unanswered(message: String) : RemoteCallException(message)
/** The desktop answered with an error. */
class Rejected(message: String) : RemoteCallException(message)

private class Denied(message: String) : Exception(message)

/**
 * The phone's connection to the desktop bridge, a port of shared/remote-client.
 * Everything mutable lives on [dispatcher], one task at a time; socket
 * callbacks and the public methods hop onto it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemoteClient(
    start: RemoteStart,
    private val listener: RemoteClientListener = object : RemoteClientListener {},
    private val sockets: SocketFactory = OkHttpSockets(),
    private val options: RemoteClientOptions = RemoteClientOptions(),
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1),
    private val now: () -> Long = System::currentTimeMillis,
    private val warn: (String, Throwable?) -> Unit = { message, error -> System.err.println("$message $error") },
) {
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    @Volatile private var target: RemoteStart = start
    @Volatile private var host: String? = null
    @Volatile private var bridgeVersion: Int? = null

    private val _status = MutableStateFlow(RemoteStatus(LinkState.Offline))
    val status: StateFlow<RemoteStatus> = _status.asStateFlow()
    private val _events = MutableSharedFlow<RemoteEvent>(extraBufferCapacity = 1024)
    /** Events with patches already applied; [RemoteClientListener.onEvent] hears them first. */
    val events: SharedFlow<RemoteEvent> = _events.asSharedFlow()

    private var current: Dial? = null
    private var channel: Channel? = null
    private val calls = HashMap<Long, Pending>()
    private var nextCall = 1L
    private var closed = true
    private var retry = 0
    private var retryTimer: Job? = null
    private var watchdog: Job? = null
    private var heard = 0L
    private var attempt = 0
    private val dials = LinkedHashSet<Dial>()
    private var betterTimer: Job? = null
    private val worse = HashMap<String, Long>()
    /** Answers still streaming on this connection, as JSON, for `messagePatch`. */
    private val streaming = HashMap<String, JsonObject>()
    private var chats: List<RemoteChatSummary>? = null

    private class Pending(val result: CompletableDeferred<JsonElement>, val timer: Job)

    /** Raw TCP to the desktop's own loopback over this link, from Bridge.TUNNEL. */
    val tunnel = TunnelStreams(::post, ::sendTunnel, { channel != null && supports(Bridge.TUNNEL) }, { name })

    /** The desktop's name, from the link or the saved credentials. */
    val name: String
        get() = when (val t = target) {
            is RemoteStart.Pair -> t.link.name
            is RemoteStart.Saved -> t.credentials.name
        }

    /** The connected desktop's bridge version; null while offline or for desktops that don't say. */
    val bridge: Int? get() = bridgeVersion

    /** Whether the connected desktop speaks a bridge feature, e.g. `supports(Bridge.DRAFTS)`. */
    fun supports(feature: Int) = (bridgeVersion ?: 0) >= feature

    val credentials: RemoteCredentials? get() = (target as? RemoteStart.Saved)?.credentials

    /** Which way the link runs now. */
    val route: RemoteRoute?
        get() {
            val h = host
            return if (_status.value.state == LinkState.Online && h != null) RemoteRoute(h, Routes.kind(h)) else null
        }

    val routes: List<RouteKind>
        get() = (target as? RemoteStart.Saved)?.credentials?.routes ?: Routes.default

    fun start() = post {
        if (!closed) return@post
        closed = false
        connect()
    }

    fun close() = post {
        closed = true
        retryTimer?.cancel()
        cancelDials()
        drop("Disconnected.")
        setStatus(LinkState.Offline)
    }

    /** A new order: kept with the credentials, and the link moves if an earlier route answers. */
    fun setRoutes(routes: List<RouteKind>) = post {
        val t = target as? RemoteStart.Saved ?: return@post
        target = RemoteStart.Saved(t.credentials.copy(routes = routes))
        listener.onCredentials(t.credentials.copy(routes = routes))
        worse.clear()
        tryBetter()
    }

    /**
     * Reconnects now instead of waiting out the backoff, e.g. back in the
     * foreground. A link quiet for more than half the stale time is likely
     * dead (Android drops sockets in the background), so it reconnects.
     */
    fun wake() = post {
        val state = _status.value.state
        if (closed || state == LinkState.Denied) return@post
        val quiet = state == LinkState.Online && now() - heard > options.staleMs / 2
        if (state == LinkState.Offline || quiet) {
            if (quiet) drop("Connection lost.")
            retryTimer?.cancel()
            retry = 0
            connect()
        } else if (state == LinkState.Online) {
            worse.clear()
            tryBetter()
        }
    }

    /** One bridge call. Throws [NotConnected], [Unanswered] or [Rejected]. Nulls go as JSON null. */
    suspend fun call(method: String, args: List<JsonElement?> = emptyList(), timeoutMs: Long? = null): JsonElement {
        val wait = timeoutMs ?: if (method in Bridge.slowRemoteMethods) options.slowTimeoutMs else options.timeoutMs
        val pending = withContext(dispatcher) { request(method, JsonArray(args.map { it ?: JsonNull }), wait) }
        return pending.await()
    }

    /**
     * One of the desktop's own calls on the phone's allowlist. Trailing nulls
     * go (JSON would turn a left-out argument into null, which the desktop
     * refuses), and a send's `to` goes for desktops that don't know it.
     */
    suspend fun desktop(method: String, args: List<JsonElement?> = emptyList()): JsonElement {
        val sent = args.toMutableList()
        while (sent.isNotEmpty() && (sent.last() == null || sent.last() is JsonNull)) sent.removeAt(sent.lastIndex)
        if (method == "sendProjectChat" && (bridgeVersion ?: 0) < Bridge.RECIPIENT) {
            val send = sent.getOrNull(1) as? JsonObject
            if (send != null) sent[1] = JsonObject(send - "to")
        }
        val wait = if (method in Bridge.slowPhoneMethods) options.slowTimeoutMs else options.timeoutMs
        val pending = withContext(dispatcher) {
            request("desktop", JsonArray(listOf(JsonPrimitive(method), JsonArray(sent.map { it ?: JsonNull }))), wait)
        }
        return pending.await()
    }

    private fun request(method: String, args: JsonArray, timeoutMs: Long): CompletableDeferred<JsonElement> {
        if (_status.value.state != LinkState.Online || channel == null) throw NotConnected("Not connected to $name.")
        val id = nextCall++
        val result = CompletableDeferred<JsonElement>()
        val timer = scope.launch {
            delay(timeoutMs)
            if (calls.remove(id) != null) result.completeExceptionally(Unanswered("$name didn't answer in time."))
        }
        calls[id] = Pending(result, timer)
        sendFrame(buildJsonObject {
            put("t", "call")
            put("id", id)
            put("method", method)
            put("args", args)
        })
        return result
    }

    private fun post(block: () -> Unit) {
        scope.launch { block() }
    }

    private fun setStatus(state: LinkState, detail: String? = null) {
        val status = RemoteStatus(state, detail)
        _status.value = status
        listener.onStatus(status)
    }

    private data class Endpoint(val hosts: List<String>, val port: Int, val key: String)

    private val endpoint: Endpoint
        get() = when (val t = target) {
            is RemoteStart.Pair -> Endpoint(t.link.hosts, t.link.port, t.link.key)
            is RemoteStart.Saved -> Endpoint(t.credentials.hosts, t.credentials.port, t.credentials.key)
        }

    private fun connect() {
        val mine = ++attempt
        cancelDials()
        setStatus(LinkState.Connecting)
        val order = Routes.order(endpoint.hosts, routes)
        var reason = "Can't reach $name."
        race(order, object : Race {
            override fun stale() = closed || mine != attempt
            override fun claim(link: Link): Boolean {
                attach(link)
                return true
            }
            override fun failed(error: Exception) {
                if (error is Denied) {
                    closed = true
                    setStatus(LinkState.Denied, error.message)
                    return
                }
                reason = error.message?.ifEmpty { null } ?: reason
            }
            override fun done() {
                setStatus(LinkState.Offline, reason)
                scheduleRetry()
            }
        })
    }

    private interface Race {
        fun stale(): Boolean
        fun claim(link: Link): Boolean
        fun failed(error: Exception) {}
        fun done()
    }

    private class Link(val dial: Dial, val channel: Channel, val host: String, val frame: ServerFrame)

    /**
     * Dials the hosts in order, each a little after the one before unless that
     * one already failed, and keeps the first that signs in. A pairing code
     * works once, so when pairing, the first channel to open alone sends it.
     */
    private fun race(order: List<String>, on: Race) {
        val (_, port, key) = endpoint
        val serverKey = Base64Url.decodeOrNull(key)
        if (serverKey == null || serverKey.size != 32) {
            on.failed(Exception("Couldn't verify $name. Pair again."))
            return on.done()
        }
        val pairing = target is RemoteStart.Pair
        val mine = LinkedHashSet<Dial>()
        var next = 0
        var won = false
        var signing: Dial? = null
        var timer: Job? = null
        fun settle() {
            timer?.cancel()
            for (d in mine.toList()) {
                d.cancel()
                dials.remove(d)
            }
        }
        fun dialNext() {
            timer?.cancel()
            if (won || signing != null || on.stale() || next >= order.size) return
            val host = order[next++]
            val dial = Dial(host, port, serverKey, object : DialHandlers {
                override fun signIn(dial: Dial): Boolean {
                    if (!pairing) return true
                    if (won || signing != null || on.stale()) return false
                    signing = dial
                    timer?.cancel()
                    for (other in mine.toList()) if (other !== dial) {
                        other.cancel()
                        mine.remove(other)
                        dials.remove(other)
                    }
                    return true
                }
                override fun claim(dial: Dial, link: Link): Boolean {
                    mine.remove(dial)
                    dials.remove(dial)
                    if (won || on.stale() || !on.claim(link)) return false
                    won = true
                    settle()
                    return true
                }
                override fun failed(dial: Dial, error: Exception) {
                    mine.remove(dial)
                    dials.remove(dial)
                    if (signing === dial) signing = null
                    if (won || on.stale()) return
                    on.failed(error)
                    // A refusal from the pinned desktop holds for every route.
                    if (error is Denied) return settle()
                    if (next < order.size) dialNext() else if (mine.isEmpty()) on.done()
                }
            })
            mine.add(dial)
            dials.add(dial)
            if (next < order.size) timer = scope.launch {
                delay(options.staggerMs)
                dialNext()
            }
        }
        if (order.isEmpty()) on.done() else dialNext()
    }

    private fun cancelDials() {
        for (d in dials.toList()) d.cancel()
        dials.clear()
    }

    private fun scheduleRetry() {
        retryTimer?.cancel()
        val wait = minOf(15_000L, 1000L shl minOf(retry++, 14))
        retryTimer = scope.launch {
            delay(wait)
            connect()
        }
    }

    /** Takes a signed-in link as the connection, the desktop's word on its addresses with it. */
    private fun attach(link: Link) {
        current = link.dial
        channel = link.channel
        host = link.host
        bridgeVersion = link.frame.bridge
        streaming.clear()
        chats = null
        // Streams belong to the socket they opened on.
        tunnel.reset("Relay moved to another route.")
        val fresh = link.frame.hosts?.filter(::validHost)
        val t = target
        if (link.frame.t == "paired" && t is RemoteStart.Pair) {
            val credentials = RemoteCredentials(
                hosts = if (!fresh.isNullOrEmpty()) Routes.learn(fresh, link.host) else t.link.hosts,
                port = t.link.port,
                key = t.link.key,
                name = link.frame.name ?: t.link.name,
                deviceId = link.frame.deviceId.orEmpty(),
                token = link.frame.token.orEmpty(),
            )
            target = RemoteStart.Saved(credentials)
            listener.onPaired(credentials)
        } else if (t is RemoteStart.Saved) {
            val was = t.credentials
            val hosts = if (!fresh.isNullOrEmpty()) Routes.learn(fresh, link.host) else was.hosts
            val name = link.frame.name ?: was.name
            val changed = hosts != was.hosts || name != was.name
            val next = was.copy(name = name, hosts = hosts)
            target = RemoteStart.Saved(next)
            if (changed) listener.onCredentials(next)
        }
        retry = 0
        keepAlive(link.dial)
        watchRoutes()
        setStatus(LinkState.Online)
    }

    /** While the link runs over a later route than it could, looks for an earlier one now and then. */
    private fun watchRoutes() {
        betterTimer?.cancel()
        betterTimer = null
        if (better().isEmpty()) return
        betterTimer = scope.launch {
            while (true) {
                delay(options.betterRouteMs)
                tryBetter()
            }
        }
    }

    /** Hosts ahead of the current one in the order, but not those that just lost to it. */
    private fun better(): List<String> {
        val order = Routes.order(endpoint.hosts, routes)
        val at = host?.let(order::indexOf) ?: -1
        val cooled = now() - options.worseCooldownMs
        return (if (at < 0) emptyList() else order.subList(0, at)).filter { h -> worse[h]?.let { it < cooled } ?: true }
    }

    /**
     * Signs in over an earlier route beside the running link and swaps to it
     * once it's in, so nothing shows as offline. Only between calls: an
     * answer on its way comes back on the socket it went out on.
     */
    private fun tryBetter() {
        if (_status.value.state != LinkState.Online || dials.isNotEmpty()) return
        val hosts = better()
        if (hosts.isEmpty()) return watchRoutes()
        val was = current
        var busy = false
        race(hosts, object : Race {
            override fun stale() = closed || current !== was
            override fun claim(link: Link): Boolean {
                // A move would cut open pages' connections, Vite's live reload among them.
                if (calls.isNotEmpty() || tunnel.active > 0) {
                    busy = true
                    return false
                }
                current?.quit()
                watchdog?.cancel()
                attach(link)
                return true
            }
            override fun done() {
                if (!busy) for (h in hosts) worse[h] = now()
                watchRoutes()
            }
        })
    }

    private interface DialHandlers {
        /** The channel is open; false leaves this route before it signs in. */
        fun signIn(dial: Dial): Boolean
        fun claim(dial: Dial, link: Link): Boolean
        fun failed(dial: Dial, error: Exception)
    }

    private enum class DialState { Dialing, Won, Done }

    /** One route: connects, opens the channel under the pinned key and signs in. */
    private inner class Dial(val host: String, port: Int, serverKey: ByteArray, private val on: DialHandlers) {
        var state = DialState.Dialing
        private var detached = false
        private var channel: Channel? = null
        private val handshake = ClientHandshake(serverKey)
        private val timer: Job = scope.launch {
            delay(options.timeoutMs)
            fail(Exception("$host didn't answer."))
        }
        val socket: RemoteSocket = sockets.open(
            "ws://${if (':' in host && !host.startsWith("[")) "[$host]" else host}:$port/",
            object : SocketListener {
                override fun onOpen() = post { if (!detached) socket.send(WireData.Text(handshake.hello)) }
                override fun onMessage(data: WireData) = post { if (!detached) message(data) }
                override fun onClosed() = post { if (!detached) closedHere() }
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
            if (state == DialState.Dialing) return fail(Exception("Can't reach $name."))
            if (state == DialState.Won && current === this) lost()
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
                    socket.send(sealFrame(ready, signInFrame().toString(), compact = false))
                    return
                }
                val wire = openWire(open, data)
                if (wire is Opened.Tunnel) {
                    if (state == DialState.Won && current === this) {
                        keepAlive(this)
                        tunnelFrame(wire.frame)
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
                keepAlive(this)
                opened = frame
            } catch (e: Exception) {
                // Anything that doesn't open under the pinned key isn't our desktop.
                if (state == DialState.Dialing) return fail(Exception("Couldn't verify $name. Pair again."))
                if (current === this) lost() else quit()
                return
            }
            // A listener's or a patch's failure is ours, not the desktop's: the link stays.
            try {
                receive(opened)
            } catch (e: Exception) {
                warn("Couldn't take in what $name sent:", e)
            }
        }
    }

    private fun signInFrame(): JsonObject = when (val t = target) {
        is RemoteStart.Pair -> buildJsonObject {
            put("t", "pair")
            put("code", t.link.code)
            put("device", t.device)
            t.kind?.let { put("kind", it) }
            put("bridge", Bridge.VERSION)
        }
        is RemoteStart.Saved -> buildJsonObject {
            put("t", "auth")
            put("deviceId", t.credentials.deviceId)
            put("token", t.credentials.token)
            put("bridge", Bridge.VERSION)
        }
    }

    private fun receive(frame: ServerFrame) {
        when (frame.t) {
            "tick" -> {
                val t = target
                val h = host
                if (frame.hosts == null || t !is RemoteStart.Saved || h == null) return
                // A network can change without dropping the listener or Tailscale; keep the next connect's routes current.
                val hosts = Routes.learn(frame.hosts.filter(::validHost), h)
                if (hosts == t.credentials.hosts) return
                val next = t.credentials.copy(hosts = hosts)
                target = RemoteStart.Saved(next)
                listener.onCredentials(next)
                worse.clear()
                watchRoutes()
                tryBetter()
            }
            "result" -> {
                val call = calls.remove(frame.id ?: return) ?: return
                call.timer.cancel()
                if (frame.ok == true) call.result.complete(frame.value ?: JsonNull)
                else call.result.completeExceptionally(Rejected(frame.error ?: "Relay refused that."))
            }
            "event" -> {
                frame.s?.let { s ->
                    sendFrame(buildJsonObject {
                        put("t", "got")
                        put("s", s)
                    })
                }
                val event = frame.event as? JsonObject ?: return
                val rebuilt = rebuildEvent(event, streaming, chats) { chats = it } ?: return
                listener.onEvent(rebuilt)
                _events.tryEmit(rebuilt)
            }
            "denied" -> {
                closed = true
                drop(frame.reason ?: "Relay said no.")
                setStatus(LinkState.Denied, frame.reason)
            }
        }
    }

    private fun lost() {
        drop("Connection lost.")
        if (closed || _status.value.state == LinkState.Denied) return
        setStatus(LinkState.Offline, "Connection lost.")
        scheduleRetry()
    }

    private fun keepAlive(dial: Dial) {
        heard = now()
        watchdog?.cancel()
        watchdog = scope.launch {
            delay(options.staleMs)
            if (current === dial) lost()
        }
    }

    private fun sendFrame(frame: JsonObject) {
        val open = channel ?: return
        val compact = (bridgeVersion ?: 0) >= Bridge.COMPACT
        current?.socket?.send(sealFrame(open, frame.toString(), compact))
    }

    private fun sendTunnel(frame: TunnelFrame) {
        val open = channel ?: return
        current?.socket?.send(sealTunnel(open, frame))
    }

    /** A tunnel frame's trouble is the tunnel's, not the link's. */
    private fun tunnelFrame(frame: TunnelFrame) {
        try {
            tunnel.receive(frame)
        } catch (e: Exception) {
            warn("Couldn't take in a tunnel frame:", e)
        }
    }

    private fun drop(reason: String) {
        watchdog?.cancel()
        betterTimer?.cancel()
        betterTimer = null
        val dial = current
        current = null
        channel = null
        host = null
        bridgeVersion = null
        streaming.clear()
        chats = null
        tunnel.reset(reason)
        dial?.quit()
        for (call in calls.values) {
            call.timer.cancel()
            call.result.completeExceptionally(Unanswered(reason))
        }
        calls.clear()
    }
}
