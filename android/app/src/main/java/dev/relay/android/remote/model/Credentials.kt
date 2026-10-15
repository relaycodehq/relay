package dev.relay.android.remote.model

import dev.relay.android.remote.RouteKind
import kotlinx.serialization.Serializable

/** What a phone keeps of a paired computer; `key` (the desktop's public key) is its id. */
@Serializable
data class RemoteCredentials(
    val hosts: List<String>,
    val port: Int,
    val key: String,
    val name: String,
    val deviceId: String,
    val token: String,
    /** Route order, first tried first; left out means local then Tailscale. */
    val routes: List<RouteKind>? = null,
)
