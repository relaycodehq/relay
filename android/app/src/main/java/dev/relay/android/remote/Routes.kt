package dev.relay.android.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class RouteKind {
    @SerialName("local") Local,
    @SerialName("tailscale") Tailscale,
}

/** `shared/remote-routes.ts`. */
object Routes {
    /** Local network first: when both answer, it's the shorter way. */
    val default: List<RouteKind> = listOf(RouteKind.Local, RouteKind.Tailscale)
    const val MAX_HOSTS = 8

    fun kind(host: String): RouteKind {
        val bare = host.replace(Regex("^\\[|]$"), "").lowercase()
        val parts = bare.split(".")
        val a = jsNumber(parts[0])
        val b = if (parts.size > 1) jsNumber(parts[1]) else Double.NaN
        if (a == 100.0 && b >= 64 && b <= 127) return RouteKind.Tailscale
        if (bare.startsWith("fd7a:115c:a1e0:") || bare.endsWith(".ts.net")) return RouteKind.Tailscale
        return RouteKind.Local
    }

    /** The hosts by route, in the order given; within a route, as they came. */
    fun order(hosts: List<String>, routes: List<RouteKind> = default): List<String> {
        fun rank(host: String) = routes.indexOf(kind(host)).let { if (it < 0) routes.size else it }
        return hosts.withIndex().sortedWith(compareBy({ rank(it.value) }, { it.index })).map { it.value }
    }

    /** The hosts the desktop named, plus the one the phone came in by. */
    fun learn(fresh: List<String>, via: String): List<String> =
        LinkedHashSet(fresh.take(MAX_HOSTS - 1) + via).toList()
}
