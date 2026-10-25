package dev.relay.android.remote

import android.os.Build
import android.util.Log
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.RemoteClientListener
import dev.relay.android.remote.client.RemoteStart
import dev.relay.android.remote.client.RemoteStatus
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.client.overview
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import dev.relay.android.remote.credentials.Paired
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteCredentials
import dev.relay.android.remote.model.RemoteEvent
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.newerVersion
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** A paired computer, by its bridge's public key. */
data class PairedComputer(
    val id: String,
    val name: String,
    /** Where the phone reaches it, to tell apart pairings that share a name. */
    val address: String,
    /** It has an address on the tailnet, so Tailscale on this phone reaches it from anywhere. */
    val tailscale: Boolean = false,
)

class PairingFailed(message: String) : Exception(message)

/** An overview just fetched from [computer] through [client], not a saved copy. */
data class FreshOverview(val computer: String, val client: RemoteClient, val overview: RemoteOverview)

/**
 * The phone's one live connection and what it knows of each paired computer
 * (mobile/src/remote/RemoteProvider). State lives on [dispatcher]; read it
 * through the StateFlows.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class Remote(
    private val store: CredentialStore,
    private val cache: OfflineCache,
    private val seen: ComputerSeen,
    /** This app's version, for [behind]. */
    private val appVersion: String,
    private val deviceName: String = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android phone",
    private val newClient: (RemoteStart, RemoteClientListener) -> RemoteClient = { start, listener -> RemoteClient(start, listener) },
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1),
    private val pairingTimeoutMs: Long = 15_000,
    private val warn: (String, Throwable) -> Unit = { m, e -> Log.w(TAG, m, e) },
) {
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    private val _ready = MutableStateFlow(false)
    /** Saved credentials have been read. */
    val ready: StateFlow<Boolean> = _ready.asStateFlow()
    private val _saved = MutableStateFlow<List<RemoteCredentials>>(emptyList())
    private val _active = MutableStateFlow<String?>(null)
    /** The computer it talks to, by id. */
    val active: StateFlow<String?> = _active.asStateFlow()
    private val _status = MutableStateFlow(RemoteStatus(LinkState.Offline))
    val status: StateFlow<RemoteStatus> = _status.asStateFlow()
    private val _overview = MutableStateFlow<RemoteOverview?>(null)
    /**
     * The active computer's overview: its last saved copy until a fresh one
     * comes, thread list and `present` kept live. `present` is the live
     * connection's word alone, never a saved copy's.
     */
    val overview: StateFlow<RemoteOverview?> = _overview.asStateFlow()
    private val _overviews = MutableSharedFlow<RemoteOverview?>(replay = 1, extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    /**
     * Each [overview] in turn, where [overview] keeps only the newest: a background batch brings
     * a thread's start and its end back to back, and news needs to see both.
     */
    val overviews: SharedFlow<RemoteOverview?> = _overviews.asSharedFlow()
    /** Presence events heard, so an overview asked for before one doesn't undo it. */
    private var presenceHeard = 0
    /** The newest presence event, which may come before there's an overview to keep it in. */
    private var livePresent: Boolean? = null
    private val _client = MutableStateFlow<RemoteClient?>(null)
    /** The live client, for calls; null when nothing is paired. */
    val client: StateFlow<RemoteClient?> = _client.asStateFlow()
    private val _events = MutableSharedFlow<RemoteEvent>(extraBufferCapacity = 1024)
    /** The live client's events, patches applied. */
    val events: SharedFlow<RemoteEvent> = _events.asSharedFlow()
    private val _fresh = MutableSharedFlow<FreshOverview>(extraBufferCapacity = 16)
    /**
     * Each overview fetched on a (re)connect or [refresh], even one equal to
     * what [overview] already holds, which then doesn't change.
     */
    val fresh: SharedFlow<FreshOverview> = _fresh.asSharedFlow()

    /** Every paired computer, in pairing order. */
    val computers: StateFlow<List<PairedComputer>> = _saved.map { list ->
        list.map {
            PairedComputer(
                it.key, it.name, "${Routes.order(it.hosts, it.routes ?: Routes.default).firstOrNull() ?: "?"}:${it.port}",
                tailscale = it.hosts.any { host -> Routes.kind(host) == RouteKind.Tailscale },
            )
        }
    }.stateIn(scope, SharingStarted.Eagerly, emptyList())

    /** The active computer's route order. */
    val routes: StateFlow<List<RouteKind>> = combine(_saved, _active) { saved, active ->
        saved.find { it.key == active }?.routes ?: Routes.default
    }.stateIn(scope, SharingStarted.Eagerly, Routes.default)

    /** The desktop runs an older bridge than this app needs. */
    val outdated: StateFlow<Boolean> = _overview.map { it != null && (it.bridge ?: 1) < Bridge.VERSION }
        .stateIn(scope, SharingStarted.Eagerly, false)

    /** The desktop runs an older Relay than this app. */
    val behind: StateFlow<Boolean> = _overview.map { o -> o?.version?.let { newerVersion(appVersion, it) } ?: false }
        .stateIn(scope, SharingStarted.Eagerly, false)

    val paired: Boolean get() = _client.value != null

    private var live: RemoteClient? = null
    /** Starts true: the app may be opened by a notification's worker with nothing on screen. */
    private var background = true
    private var networkUp = true
    /** Held around [background], [networkUp] and the client they go to, which change on different threads. */
    private val backgroundLock = Any()
    /** Where the latest switch goes, set before its offline copy is read; [_active] moves after. */
    private var wanted: String? = null
    private var switches = 0
    private var loaded = false
    private var pairing: PendingPairing? = null

    private class PendingPairing {
        var client: RemoteClient? = null
        val outcome = CompletableDeferred<String?>()
    }

    /** Reads the saved pairings and connects to the active one. Call once at launch. */
    suspend fun load() = withContext(dispatcher) {
        val saved = store.load()
        // One paired while the read went on stays beside the ones read.
        _saved.value = saved.computers + _saved.value.filter { now -> saved.computers.none { it.key == now.key } }
        loaded = true
        // A pairing cut off midway can leave no active one saved: the first computer then.
        val start = saved.computers.find { it.key == saved.paired.active } ?: saved.computers.firstOrNull()
        if (start != null && wanted == null) attach(start.key, RemoteStart.Saved(start))
        _ready.value = true
        persist()
    }

    suspend fun switchTo(id: String) = withContext(dispatcher) {
        val credentials = _saved.value.find { it.key == id }
        if (credentials != null && id != wanted) attach(id, RemoteStart.Saved(credentials))
    }

    /**
     * Pairs another computer, or the same one again, and switches to it.
     * Throws [PairingFailed] when it's refused or not reached within the
     * pairing timeout, and leaves the phone on the computer it was on.
     */
    suspend fun pair(link: PairingLink) {
        val wait = PendingPairing()
        val before = withContext(dispatcher) {
            pairing = wait
            val before = _active.value
            attach(link.key, RemoteStart.Pair(link, deviceName))
            before
        }
        val failure = withTimeoutOrNull(pairingTimeoutMs) { wait.outcome.await() }
            ?: withContext(dispatcher) {
                // A pairing started meanwhile took over; this one doesn't put the phone back.
                if (pairing !== wait) throw PairingFailed("Another pairing took over.")
                pairing = null
                "Couldn't reach ${link.name} at ${link.hosts.joinToString(" or ")}:${link.port}. " +
                    "Check that Relay is open there and the phone is on the same network, or both on Tailscale."
            }
        if (failure.isEmpty()) return
        withContext(dispatcher) {
            val previous = _saved.value.find { it.key == before }
            if (previous != null) attach(previous.key, RemoteStart.Saved(previous))
            else detach()
        }
        throw PairingFailed(failure)
    }

    /** Forgets one computer, the active one by default, and moves on to the next. */
    suspend fun forget(id: String? = _active.value) {
        if (id == null) return
        withContext(dispatcher) {
            val rest = _saved.value.filter { it.key != id }
            _saved.value = rest
            if (id == _active.value) {
                val next = rest.firstOrNull()
                if (next != null) attach(next.key, RemoteStart.Saved(next)) else detach()
            }
            persist()
        }
        cache.forget(id)
        seen.forget(id)
        store.clearCredentials(id)
    }

    /** Forgets every computer, the saved ones too: forgotten before they're read, they'd come back. */
    suspend fun forgetAll() {
        _ready.first { it }
        withContext(dispatcher) { _saved.value.map { it.key } }.forEach { forget(it) }
    }

    fun setRoutes(routes: List<RouteKind>) {
        live?.setRoutes(routes)
    }

    /** Back in the foreground: Android drops sockets in the background. */
    fun wake() {
        live?.wake()
    }

    /** Whether the app is in the background, for the link to the active computer and the next. */
    fun setBackground(on: Boolean) = synchronized(backgroundLock) {
        background = on
        live?.setBackground(on)
    }

    /** Whether the phone has a network, for the link to the active computer and the next. */
    fun setNetwork(up: Boolean) = synchronized(backgroundLock) {
        networkUp = up
        live?.setNetwork(up)
    }

    /** A fresh overview, when online. */
    suspend fun refresh(): RemoteOverview? {
        val client = _client.value ?: return null
        if (client.status.value.state != LinkState.Online) return null
        val heard = withContext(dispatcher) { presenceHeard }
        val fresh = client.overview()
        return withContext(dispatcher) {
            if (live !== client) return@withContext null
            setFresh(client, fresh, heard)
            fresh
        }
    }

    /** True once the computer is reached, false after [timeoutMs] without it. */
    suspend fun whenOnline(timeoutMs: Long): Boolean =
        withTimeoutOrNull(timeoutMs) { _status.first { it.state == LinkState.Online } } != null

    /** One thread's message events. */
    fun messages(chatId: String): Flow<RemoteEvent.Message> =
        _events.filterIsInstance<RemoteEvent.Message>().filter { it.chatId == chatId }

    /**
     * A thread kept current: fetched on every (re)connect, reusing the
     * messages already held, and patched with its message events between.
     */
    fun chat(chatId: String, history: Int? = null): Flow<RemoteChat> = kotlinx.coroutines.flow.channelFlow {
        var held: RemoteChat? = null
        launch {
            messages(chatId).collect { event ->
                val chat = held ?: return@collect
                val at = chat.messages.indexOfFirst { it.id == event.message.id }
                val messages = if (at < 0) chat.messages + event.message
                else chat.messages.toMutableList().also { it[at] = event.message }
                held = chat.copy(messages = messages, title = event.title ?: chat.title)
                send(held!!)
            }
        }
        _status.collect { status ->
            val client = _client.value
            if (status.state != LinkState.Online || client == null) return@collect
            try {
                held = client.chat(chatId, held, history)
                send(held!!)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
            }
        }
    }.flowOn(dispatcher)

    private fun persist() {
        if (!_ready.value || (!loaded && _saved.value.isEmpty())) return
        val saved = _saved.value
        val active = saved.find { it.key == _active.value }?.key
        save("the paired computers") { store.savePaired(Paired(saved.map { it.key }, active)) }
    }

    /** A Keystore that won't load fails the save, not the app; the files stay as they were. */
    private fun save(what: String, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                warn("Couldn't save $what", e)
            }
        }
    }

    private fun setOverview(overview: RemoteOverview?) {
        show(overview)
        val id = _active.value
        if (overview != null && id != null) scope.launch { cache.save(id, overview) }
    }

    private fun show(overview: RemoteOverview?) {
        _overview.value = overview
        _overviews.tryEmit(overview)
    }

    /**
     * [heard] is [presenceHeard] when the overview was asked for. A presence
     * event since is newer than the overview (it comes after the reply on the
     * wire), and the desktop tells it again if not.
     */
    private fun setFresh(client: RemoteClient, overview: RemoteOverview, heard: Int) {
        val kept = if (heard == presenceHeard) overview else overview.copy(present = livePresent)
        setOverview(kept)
        _active.value?.let { _fresh.tryEmit(FreshOverview(it, client, kept)) }
    }

    /** Talks to this computer from now on, showing its last seen lists while it connects. */
    private suspend fun attach(id: String, start: RemoteStart) {
        wanted = id
        val mine = ++switches
        val cached = cache.load(id)
        // Tapped another computer while this one's copy was read.
        if (mine != switches) return
        // Another computer's presence, or a saved copy's, never counts. Pairing
        // the same one again keeps what it said until the fresh overview.
        val same = id == _active.value
        _active.value = id
        show(cached?.copy(present = if (same) _overview.value?.present else null))
        connect(start)
        persist()
    }

    private fun detach() {
        wanted = null
        switches++
        _active.value = null
        show(null)
        live?.close()
        live = null
        _client.value = null
        _status.value = RemoteStatus(LinkState.Offline)
    }

    private fun connect(start: RemoteStart): RemoteClient {
        lateinit var next: RemoteClient
        fun onLive(block: () -> Unit) {
            scope.launch { if (live === next) block() }
        }
        next = newClient(start, object : RemoteClientListener {
            override fun onStatus(status: RemoteStatus) = onLive {
                _status.value = status
                when (status.state) {
                    LinkState.Online -> {
                        _active.value?.let(seen::reached)
                        pairing?.takeIf { it.client === next }?.let {
                            pairing = null
                            it.outcome.complete("")
                        }
                        // Every (re)connect starts from a fresh overview.
                        val heard = presenceHeard
                        scope.launch {
                            try {
                                val fresh = next.overview()
                                if (live === next) setFresh(next, fresh, heard)
                            } catch (_: Exception) {
                            }
                        }
                    }
                    LinkState.Denied -> pairing?.takeIf { it.client === next }?.let {
                        pairing = null
                        it.outcome.complete(status.detail ?: "Relay said no.")
                    }
                    else -> {}
                }
            }

            override fun onPaired(credentials: RemoteCredentials) = onLive {
                save("${credentials.name}'s pairing") { store.saveCredentials(credentials) }
                _saved.value = _saved.value.filter { it.key != credentials.key } + credentials
                persist()
            }

            // New addresses or route order: kept in place, the list's order stays.
            override fun onCredentials(credentials: RemoteCredentials) = onLive {
                save("${credentials.name}'s addresses") { store.saveCredentials(credentials) }
                _saved.value = _saved.value.map { if (it.key == credentials.key) credentials else it }
            }

            override fun onEvent(event: RemoteEvent) = onLive {
                when (event) {
                    is RemoteEvent.Chats -> _overview.value?.let { setOverview(it.copy(chats = event.chats)) }
                    is RemoteEvent.Appearance -> _overview.value?.let { setOverview(it.copy(appearance = event.appearance)) }
                    is RemoteEvent.Presence -> {
                        presenceHeard++
                        livePresent = event.present
                        _overview.value?.let { setOverview(it.copy(present = event.present)) }
                    }
                    else -> {}
                }
                _events.tryEmit(event)
            }
        })
        val previous = live
        // The client's first word on the link, before start(), and never after a newer one.
        synchronized(backgroundLock) {
            live = next
            next.setBackground(background)
            next.setNetwork(networkUp)
        }
        livePresent = null
        previous?.close()
        _client.value = next
        _status.value = next.status.value
        if (start is RemoteStart.Pair) pairing?.client = next
        next.start()
        return next
    }
}

private const val TAG = "Remote"
