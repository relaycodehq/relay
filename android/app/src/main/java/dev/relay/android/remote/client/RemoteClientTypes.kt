package dev.relay.android.remote.client

import dev.relay.android.remote.PairingLink
import dev.relay.android.remote.RouteKind
import dev.relay.android.remote.model.RemoteCredentials
import dev.relay.android.remote.model.RemoteEvent

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

/** The pinned desktop refused this phone; it holds for every route. */
internal class Denied(message: String) : Exception(message)
